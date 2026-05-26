/**
 * Cloud accumulator — a world-frame point cache wrapped as THREE.Points so
 * the 3D panel can render the running "map" built up over many frames.
 *
 * Two modes:
 *
 *   1. ring (default)
 *      Pre-allocated Float32Array of fixed capacity; new points wrap and
 *      overwrite the oldest FIFO. Cheap per-append, no allocation, ideal
 *      for "what was visible in the last N frames".
 *
 *   2. voxel
 *      Each appended point is bucketed into a regular 3D grid keyed by
 *      (floor(x/v), floor(y/v), floor(z/v)). Only one point per bucket is
 *      kept (the most recent), so a long flight that revisits the same
 *      ground produces a single down-sampled map of that ground rather
 *      than ten ring-buffer copies of it. Capacity is still bounded — when
 *      the voxel set hits the budget we evict by insertion order, but in
 *      practice a 0.2 m voxel over a hectare comfortably fits in the
 *      defaults.
 *
 * Shared design notes:
 *   - Per-point affine transform is inlined in append() so we don't pay
 *     THREE.Vector3 allocation + applyMatrix4 dispatch per point.
 *   - frustumCulled = false on the THREE.Points so we don't pay the O(n)
 *     bounding-sphere computation on every append (1M-point sphere on
 *     every LiDAR frame would noticeably slow playback).
 *   - Mode changes are non-destructive only when the buffer is empty;
 *     switching modes mid-flight clears stored points because the storage
 *     layout differs.
 */

import * as THREE from 'three';

export type AccumulationMode = 'ring' | 'voxel';

export interface AccumulatorStats {
  pointCount: number;
  capacity: number;
  framesAccumulated: number;
  /** True when the ring buffer is full and new points are evicting old ones. */
  evicting: boolean;
}

/**
 * Pack a (vx, vy, vz) voxel coordinate into a single string key. The grid
 * spans roughly ±2^21 voxels per axis at any sensible voxel size, which is
 * enough for kilometre-scale maps at sub-metre voxels. Beyond that the
 * caller is in "build a planet" territory and should be downsampling
 * upstream.
 */
function voxelKey(vx: number, vy: number, vz: number): string {
  return `${vx}|${vy}|${vz}`;
}

interface VoxelEntry {
  /** Slot in the positions/colors arrays (in points, not floats). */
  slot: number;
  /** Monotonically-increasing insertion order, for FIFO eviction. */
  inserted: number;
}

export class CloudAccumulator {
  private positions: Float32Array;
  private colors: Float32Array;
  private capacity: number;
  private mode: AccumulationMode = 'ring';
  private voxelSize = 0.2; // metres

  // ── Ring-buffer state ────────────────────────────────────────────────
  private writeHead = 0;
  private filled = 0;

  // ── Voxel-grid state ─────────────────────────────────────────────────
  /** Map of voxel key → slot in positions/colors. */
  private voxels: Map<string, VoxelEntry> = new Map();
  private voxelInsertCounter = 0;

  private framesAdded = 0;

  public readonly geometry: THREE.BufferGeometry;
  public readonly material: THREE.PointsMaterial;
  public readonly object: THREE.Points;

  constructor(capacity: number, pointSize: number) {
    this.capacity = Math.max(1, Math.floor(capacity));
    this.positions = new Float32Array(this.capacity * 3);
    this.colors = new Float32Array(this.capacity * 3);

    this.geometry = new THREE.BufferGeometry();
    const posAttr = new THREE.BufferAttribute(this.positions, 3);
    posAttr.setUsage(THREE.DynamicDrawUsage);
    const colAttr = new THREE.BufferAttribute(this.colors, 3);
    colAttr.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('position', posAttr);
    this.geometry.setAttribute('color', colAttr);
    this.geometry.setDrawRange(0, 0);

    this.material = new THREE.PointsMaterial({
      size: pointSize,
      sizeAttenuation: false,
      vertexColors: true,
      transparent: false,
      depthWrite: true,
    });

    this.object = new THREE.Points(this.geometry, this.material);
    this.object.frustumCulled = false;
  }

  setPointSize(size: number): void {
    this.material.size = size;
  }

  setMode(mode: AccumulationMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    // Storage layouts diverge — easiest to start fresh on mode change.
    this.clear();
  }

  /**
   * Set the voxel edge length in metres. A new size invalidates the existing
   * voxel index, so we clear and start fresh. Ring mode is unaffected.
   */
  setVoxelSize(metres: number): void {
    const v = Math.max(0.01, metres);
    if (v === this.voxelSize) return;
    this.voxelSize = v;
    if (this.mode === 'voxel') this.clear();
  }

  /**
   * Append a frame to the buffer. The incoming positions are in the cloud's
   * source frame; `worldMatrix` is composeTFChain(source, world, t) so we can
   * write world-frame coordinates and the accumulator stays decoupled from
   * userGroup.matrix.
   *
   * `stride` lets the caller sub-sample the incoming frame on the way in,
   * so the per-frame contribution is bounded regardless of how many points
   * the decoder produced. Stride is applied before the voxel snap (so the
   * voxel set sees a uniform subsample of source points, not "every Nth").
   */
  append(
    sourcePositions: Float32Array,
    sourceColors: Float32Array,
    sourceCount: number,
    worldMatrix: THREE.Matrix4,
    stride: number = 1,
  ): void {
    if (sourceCount === 0) return;
    if (this.mode === 'voxel') {
      this.appendVoxel(sourcePositions, sourceColors, sourceCount, worldMatrix, stride);
    } else {
      this.appendRing(sourcePositions, sourceColors, sourceCount, worldMatrix, stride);
    }
    this.framesAdded++;
    const posAttr = this.geometry.getAttribute('position') as THREE.BufferAttribute;
    const colAttr = this.geometry.getAttribute('color') as THREE.BufferAttribute;
    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
  }

  private appendRing(
    sourcePositions: Float32Array,
    sourceColors: Float32Array,
    sourceCount: number,
    worldMatrix: THREE.Matrix4,
    stride: number,
  ): void {
    const m = worldMatrix.elements;
    const step = Math.max(1, Math.floor(stride));
    const cap = this.capacity;
    let head = this.writeHead;
    let filled = this.filled;

    for (let i = 0; i < sourceCount; i += step) {
      const si = i * 3;
      const sx = sourcePositions[si];
      const sy = sourcePositions[si + 1];
      const sz = sourcePositions[si + 2];
      const tx = m[0] * sx + m[4] * sy + m[8] * sz + m[12];
      const ty = m[1] * sx + m[5] * sy + m[9] * sz + m[13];
      const tz = m[2] * sx + m[6] * sy + m[10] * sz + m[14];

      const o = head * 3;
      this.positions[o] = tx;
      this.positions[o + 1] = ty;
      this.positions[o + 2] = tz;
      this.colors[o] = sourceColors[si];
      this.colors[o + 1] = sourceColors[si + 1];
      this.colors[o + 2] = sourceColors[si + 2];

      head++;
      if (head >= cap) head = 0;
      if (filled < cap) filled++;
    }

    this.writeHead = head;
    this.filled = filled;
    this.geometry.setDrawRange(0, this.filled);
  }

  private appendVoxel(
    sourcePositions: Float32Array,
    sourceColors: Float32Array,
    sourceCount: number,
    worldMatrix: THREE.Matrix4,
    stride: number,
  ): void {
    const m = worldMatrix.elements;
    const step = Math.max(1, Math.floor(stride));
    const inv = 1 / this.voxelSize;
    const cap = this.capacity;

    for (let i = 0; i < sourceCount; i += step) {
      const si = i * 3;
      const sx = sourcePositions[si];
      const sy = sourcePositions[si + 1];
      const sz = sourcePositions[si + 2];
      const tx = m[0] * sx + m[4] * sy + m[8] * sz + m[12];
      const ty = m[1] * sx + m[5] * sy + m[9] * sz + m[13];
      const tz = m[2] * sx + m[6] * sy + m[10] * sz + m[14];

      const vx = Math.floor(tx * inv);
      const vy = Math.floor(ty * inv);
      const vz = Math.floor(tz * inv);
      const key = voxelKey(vx, vy, vz);

      const entry = this.voxels.get(key);
      let slot: number;
      if (entry) {
        // Existing voxel — refresh in-place. Most recent point wins, which
        // tracks moving targets (a robot revisiting the same area) without
        // bloating the set.
        slot = entry.slot;
        entry.inserted = this.voxelInsertCounter++;
      } else {
        if (this.voxels.size >= cap) {
          // Evict the oldest voxel by insertion order — single linear pass
          // is fine because evictions only happen once we hit capacity, and
          // the map size never exceeds it.
          let oldestKey: string | null = null;
          let oldestOrder = Infinity;
          for (const [k, v] of this.voxels) {
            if (v.inserted < oldestOrder) {
              oldestOrder = v.inserted;
              oldestKey = k;
            }
          }
          if (oldestKey == null) continue;
          const evicted = this.voxels.get(oldestKey)!;
          this.voxels.delete(oldestKey);
          slot = evicted.slot;
        } else {
          slot = this.voxels.size;
        }
        this.voxels.set(key, { slot, inserted: this.voxelInsertCounter++ });
      }

      const o = slot * 3;
      this.positions[o] = tx;
      this.positions[o + 1] = ty;
      this.positions[o + 2] = tz;
      this.colors[o] = sourceColors[si];
      this.colors[o + 1] = sourceColors[si + 1];
      this.colors[o + 2] = sourceColors[si + 2];
    }

    this.filled = this.voxels.size;
    this.geometry.setDrawRange(0, this.filled);
  }

  clear(): void {
    this.writeHead = 0;
    this.filled = 0;
    this.framesAdded = 0;
    this.voxels.clear();
    this.voxelInsertCounter = 0;
    this.geometry.setDrawRange(0, 0);
    const posAttr = this.geometry.getAttribute('position') as THREE.BufferAttribute;
    const colAttr = this.geometry.getAttribute('color') as THREE.BufferAttribute;
    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
  }

  /**
   * Reallocate to a new capacity. Drops existing data — the assumption is the
   * user moves the budget slider only when they're OK starting fresh.
   */
  resize(capacity: number): void {
    const cap = Math.max(1, Math.floor(capacity));
    if (cap === this.capacity) return;
    this.capacity = cap;
    this.positions = new Float32Array(cap * 3);
    this.colors = new Float32Array(cap * 3);
    const posAttr = new THREE.BufferAttribute(this.positions, 3);
    posAttr.setUsage(THREE.DynamicDrawUsage);
    const colAttr = new THREE.BufferAttribute(this.colors, 3);
    colAttr.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('position', posAttr);
    this.geometry.setAttribute('color', colAttr);
    this.writeHead = 0;
    this.filled = 0;
    this.framesAdded = 0;
    this.voxels.clear();
    this.voxelInsertCounter = 0;
    this.geometry.setDrawRange(0, 0);
  }

  getStats(): AccumulatorStats {
    return {
      pointCount: this.filled,
      capacity: this.capacity,
      framesAccumulated: this.framesAdded,
      evicting:
        this.mode === 'ring' ? this.filled >= this.capacity : this.voxels.size >= this.capacity,
    };
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
