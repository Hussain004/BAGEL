/**
 * Cloud accumulator — a fixed-capacity ring buffer of world-frame points,
 * wrapped as a THREE.Points so the 3D panel can render the running "map"
 * built up over many frames.
 *
 * Design choices:
 *   - Pre-allocated Float32Array buffers (positions + colors). No allocation
 *     per appended frame, no GC pressure during playback.
 *   - Ring-buffer semantics: when the buffer fills, new points overwrite the
 *     oldest. Visually unordered, so the wrap is invisible to the user.
 *   - Per-point affine transform done inline in append() — composeTFChain()
 *     gives us a source→world Matrix4 and we apply it during the copy, so
 *     the accumulator stores everything in the chosen world frame and is
 *     therefore decoupled from the panel's userGroup.matrix.
 *   - frustumCulled = false on the THREE.Points so we don't pay the O(n)
 *     bounding-sphere computation on every append (1M-point sphere on every
 *     LiDAR frame would noticeably slow playback).
 *
 * Voxel-grid downsampling is the proper "build a map of the whole field"
 * primitive — slated for v0.5. For v0.4 this stride+ring-buffer combination
 * gives roughly the last N frames at the user's chosen density, which is
 * enough for visual inspection of short flights.
 */

import * as THREE from 'three';

export interface AccumulatorStats {
  pointCount: number;
  capacity: number;
  framesAccumulated: number;
}

export class CloudAccumulator {
  private positions: Float32Array;
  private colors: Float32Array;
  private capacity: number;
  /** Next write index, in points (not floats). */
  private writeHead = 0;
  /** How many points are currently valid in the buffer. Saturates at capacity. */
  private filled = 0;
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
    // Skip frustum culling so we don't recompute the bounding sphere on each
    // append. The whole buffer is one render anyway.
    this.object.frustumCulled = false;
  }

  setPointSize(size: number): void {
    this.material.size = size;
  }

  /**
   * Append a frame to the buffer. The incoming positions are in the cloud's
   * source frame; `worldMatrix` is composeTFChain(source, world, t) so we can
   * write world-frame coordinates and the accumulator stays decoupled from
   * userGroup.matrix.
   *
   * `stride` lets the caller sub-sample the incoming frame on the way in,
   * so the per-frame contribution is bounded regardless of how many points
   * the decoder produced.
   */
  append(
    sourcePositions: Float32Array,
    sourceColors: Float32Array,
    sourceCount: number,
    worldMatrix: THREE.Matrix4,
    stride: number = 1,
  ): void {
    if (sourceCount === 0) return;
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
      // Affine transform (mat4 * [x,y,z,1]). Inlined so we don't pay
      // THREE.Vector3 allocation + applyMatrix4 dispatch per point.
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
    this.framesAdded++;

    const posAttr = this.geometry.getAttribute('position') as THREE.BufferAttribute;
    const colAttr = this.geometry.getAttribute('color') as THREE.BufferAttribute;
    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
    this.geometry.setDrawRange(0, this.filled);
  }

  clear(): void {
    this.writeHead = 0;
    this.filled = 0;
    this.framesAdded = 0;
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
    this.geometry.setDrawRange(0, 0);
  }

  getStats(): AccumulatorStats {
    return {
      pointCount: this.filled,
      capacity: this.capacity,
      framesAccumulated: this.framesAdded,
    };
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
