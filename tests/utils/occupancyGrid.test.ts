import { describe, it, expect } from 'vitest';
import {
  decodeOccupancyGrid,
  isOccupancyGridType,
  resolveOccupancyGridScheme,
  type OccupancyGridMessage,
} from '../../src/utils/occupancyGrid';

function buildGrid(
  width: number,
  height: number,
  cells: number[],
  overrides: Partial<OccupancyGridMessage> = {},
): OccupancyGridMessage {
  return {
    header: { frame_id: 'map' },
    info: {
      width,
      height,
      resolution: 0.1,
      origin: {
        position: { x: -5, y: -5, z: 0 },
        orientation: { x: 0, y: 0, z: 0, w: 1 },
      },
    },
    data: cells,
    ...overrides,
  };
}

describe('occupancyGrid/decodeOccupancyGrid', () => {
  it('returns null on missing info or data', () => {
    expect(decodeOccupancyGrid(null)).toBeNull();
    expect(decodeOccupancyGrid(undefined)).toBeNull();
    expect(decodeOccupancyGrid({ info: { width: 2, height: 2, resolution: 0.1 } })).toBeNull();
  });

  it('rejects malformed dimensions', () => {
    expect(decodeOccupancyGrid(buildGrid(0, 2, [0, 0]))).toBeNull();
    expect(decodeOccupancyGrid(buildGrid(2, -1, [0, 0]))).toBeNull();
  });

  it('rejects zero or negative resolution (degenerate maps)', () => {
    expect(
      decodeOccupancyGrid({
        info: { width: 1, height: 1, resolution: 0 },
        data: [0],
      }),
    ).toBeNull();
  });

  it('rejects data arrays shorter than width × height', () => {
    expect(decodeOccupancyGrid(buildGrid(2, 2, [0, 0, 0]))).toBeNull();
  });

  it('maps -1 (unknown) to fully transparent', () => {
    const decoded = decodeOccupancyGrid(buildGrid(1, 1, [-1]));
    expect(decoded).not.toBeNull();
    expect(Array.from(decoded!.rgba)).toEqual([0, 0, 0, 0]);
  });

  it('maps 0 (free) to light grey at ~60% alpha', () => {
    const decoded = decodeOccupancyGrid(buildGrid(1, 1, [0]));
    expect(decoded!.rgba[0]).toBe(240);
    expect(decoded!.rgba[3]).toBe(153); // ~60%
  });

  it('maps 100 (occupied) to near-black at ~95% alpha', () => {
    const decoded = decodeOccupancyGrid(buildGrid(1, 1, [100]));
    expect(decoded!.rgba[0]).toBe(10);
    expect(decoded!.rgba[3]).toBe(242);
  });

  it('ramps mid values (1-99) linearly between free and occupied colours', () => {
    const decoded = decodeOccupancyGrid(buildGrid(3, 1, [0, 50, 100]));
    expect(decoded).not.toBeNull();
    const [freeR, , , freeA, midR, , , midA, occR, , , occA] = decoded!.rgba;
    // Grey ramps from 240 (free) → 10 (occupied), so 50 → ~125.
    expect(midR).toBeGreaterThan(occR);
    expect(midR).toBeLessThan(freeR);
    // Alpha climbs from 153 → 242 monotonically.
    expect(midA).toBeGreaterThan(freeA);
    expect(midA).toBeLessThan(occA);
  });

  it('sign-extends -1 even when the serializer hands back 255 (Uint8 view)', () => {
    // ROS2 over CDR uses int8 but some serializers expose it as uint8 (0…255).
    // 255 should decode as -1 → transparent.
    const decoded = decodeOccupancyGrid(
      buildGrid(2, 1, [255, 0], { data: new Uint8Array([255, 0]) }),
    );
    expect(decoded!.rgba[3]).toBe(0); // first cell is unknown
    expect(decoded!.rgba[7]).toBe(153); // second cell is free
  });

  it('produces a stable content fingerprint for identical inputs', () => {
    const a = decodeOccupancyGrid(buildGrid(4, 4, new Array(16).fill(0)));
    const b = decodeOccupancyGrid(buildGrid(4, 4, new Array(16).fill(0)));
    expect(a!.contentKey).toBe(b!.contentKey);
  });

  it('changes the content fingerprint when a single cell flips', () => {
    const baseline = decodeOccupancyGrid(buildGrid(4, 4, new Array(16).fill(0)));
    const mutated = new Array(16).fill(0);
    mutated[7] = 100;
    const changed = decodeOccupancyGrid(buildGrid(4, 4, mutated));
    expect(changed!.contentKey).not.toBe(baseline!.contentKey);
  });

  it('propagates the origin pose into the decoded result', () => {
    const decoded = decodeOccupancyGrid(buildGrid(1, 1, [0]));
    expect(decoded!.origin.position).toEqual({ x: -5, y: -5, z: 0 });
    expect(decoded!.origin.orientation).toEqual({ x: 0, y: 0, z: 0, w: 1 });
  });

  it('defaults to the identity quaternion when origin.orientation is missing', () => {
    const decoded = decodeOccupancyGrid({
      info: {
        width: 1,
        height: 1,
        resolution: 0.1,
        origin: { position: { x: 0, y: 0, z: 0 } },
      },
      data: [0],
    });
    expect(decoded!.origin.orientation).toEqual({ x: 0, y: 0, z: 0, w: 1 });
  });
});

describe('occupancyGrid/decodeOccupancyGrid costmap scheme', () => {
  it("matches rviz's costmap palette at the special threshold values", () => {
    // 0=free(transparent), 50=mid-cost gradient, 99=inscribed inflated
    // (cyan), 100=lethal (magenta), -1=unknown (teal-grey). Values taken
    // from rviz_default_plugins' palette_builder.cpp makeCostmapPalette().
    const decoded = decodeOccupancyGrid(buildGrid(5, 1, [0, 50, 99, 100, -1]), 'costmap');
    expect(decoded).not.toBeNull();
    const px = (i: number) => Array.from(decoded!.rgba.slice(i * 4, i * 4 + 4));
    expect(px(0)).toEqual([0, 0, 0, 0]);
    expect(px(1)).toEqual([128, 0, 127, 255]);
    expect(px(2)).toEqual([0, 255, 255, 255]);
    expect(px(3)).toEqual([255, 0, 255, 255]);
    expect(px(4)).toEqual([0x70, 0x89, 0x86, 255]);
  });

  it('defaults to the grayscale map scheme when no scheme is given', () => {
    const decoded = decodeOccupancyGrid(buildGrid(1, 1, [100]));
    expect(Array.from(decoded!.rgba)).toEqual([10, 10, 10, 242]);
  });
});

describe('occupancyGrid/resolveOccupancyGridScheme', () => {
  it('infers costmap for any topic name containing "costmap"', () => {
    expect(resolveOccupancyGridScheme('auto', '/robot1/local_costmap/costmap')).toBe('costmap');
    expect(resolveOccupancyGridScheme('auto', '/global_costmap/costmap')).toBe('costmap');
    expect(resolveOccupancyGridScheme('auto', '/map')).toBe('map');
  });

  it('an explicit choice overrides the topic-name inference', () => {
    expect(resolveOccupancyGridScheme('map', '/robot1/local_costmap/costmap')).toBe('map');
    expect(resolveOccupancyGridScheme('costmap', '/map')).toBe('costmap');
  });
});

describe('occupancyGrid/isOccupancyGridType', () => {
  it('matches both ROS1 and ROS2 naming forms', () => {
    expect(isOccupancyGridType('nav_msgs/OccupancyGrid')).toBe(true);
    expect(isOccupancyGridType('nav_msgs/msg/OccupancyGrid')).toBe(true);
    expect(isOccupancyGridType('')).toBe(false);
    expect(isOccupancyGridType('nav_msgs/Path')).toBe(false);
  });
});
