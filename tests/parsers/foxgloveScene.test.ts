// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { MARKER_ACTION_REPLACE_NAMESPACE, translateFoxgloveMessage } from '../../src/parsers/foxgloveSchemas';
import { MARKER_TYPE, extractMarkers } from '../../src/components/panels/ThreeDScene/markerObjects';
import { MarkerSet } from '../../src/components/panels/ThreeDScene/markerSet';
import { parseBag, readDeserializedMessages, readMessageAtTime, disposeParserCaches } from '../../src/parsers/core';
import { createFileSource } from '../../src/parsers/source';
import { isMarkerArrayType } from '../../src/utils/messages';
import { writeJsonMcap } from '../fixtures/jsonMcap';

afterEach(() => disposeParserCaches());

const P = { position: { x: 1, y: 2, z: 3 }, orientation: { x: 0, y: 0, z: 0, w: 1 } };
const RED = { r: 1, g: 0, b: 0, a: 1 };
const xyz = (x: number, y: number, z = 0) => ({ x, y, z });
type M = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const markers = (update: object): M[] => (translateFoxgloveMessage('foxglove.SceneUpdate', update as never) as { markers: M[] }).markers;

describe('SceneUpdate to markers', () => {
  it('is a marker topic', () => {
    expect(isMarkerArrayType('foxglove.SceneUpdate')).toBe(true);
  });

  it('every entity starts by replacing its own namespace, then lists its primitives with frame, time and lifetime', () => {
    const m = markers({
      entities: [{ timestamp: { sec: 10, nsec: 500 }, frame_id: 'base_link', id: 'obstacles', lifetime: { sec: 2, nsec: 0 }, cubes: [{ pose: P, size: xyz(1, 2, 3), color: RED }], spheres: [{ pose: P, size: xyz(2, 2, 2), color: RED }] }],
    });
    expect(m.map((x) => [x.ns, x.type, x.action])).toEqual([
      ['obstacles', 0, MARKER_ACTION_REPLACE_NAMESPACE],
      ['obstacles', MARKER_TYPE.CUBE, 0],
      ['obstacles', MARKER_TYPE.SPHERE, 0],
    ]);
    expect(m[1]).toMatchObject({ header: { frame_id: 'base_link', stamp: { sec: 10, nsec: 500 } }, scale: xyz(1, 2, 3), color: RED, lifetime: { sec: 2, nanosec: 0 } });
    expect(m[1].pose).toEqual(P);
    expect(m.slice(1).map((x) => x.id)).toEqual([0, 1]); // distinct within the namespace
  });

  it('arrows become one marker whose length is shaft plus head', () => {
    const [, a] = markers({ entities: [{ id: 'a', arrows: [{ pose: P, shaft_length: 1, shaft_diameter: 0.1, head_length: 0.25, head_diameter: 0.3, color: RED }] }] });
    expect(a).toMatchObject({ type: MARKER_TYPE.ARROW, scale: { x: 1.25, y: 0.3, z: 0.3 } });
  });

  it('lines: strips, loops (closed), lists, thickness, per-vertex colours and indices', () => {
    const pts = [xyz(0, 0), xyz(1, 0), xyz(1, 1)];
    const m = markers({
      entities: [{
        id: 'l',
        lines: [
          { type: 0, pose: P, thickness: 0.05, color: RED, points: pts },
          { type: 1, pose: P, thickness: 0.05, color: RED, points: pts },
          { type: 2, pose: P, thickness: 0.05, color: RED, points: pts.slice(0, 2) },
          { type: 0, pose: P, thickness: 0.05, color: RED, points: pts, colors: [RED, RED, { r: 0, g: 0, b: 1, a: 1 }], indices: [2, 0] },
          { type: 0, pose: P, points: [xyz(0, 0)] }, // one point is not a line
        ],
      }],
    });
    const lines = m.slice(1);
    expect(lines).toHaveLength(4);
    expect(lines[0]).toMatchObject({ type: MARKER_TYPE.LINE_STRIP, scale: { x: 0.05 } });
    expect(lines[0].points).toHaveLength(3);
    expect(lines[1].points).toHaveLength(4); // closed by repeating the first point
    expect(lines[1].points[3]).toEqual(pts[0]);
    expect(lines[2].type).toBe(MARKER_TYPE.LINE_LIST);
    expect(lines[3].points).toEqual([pts[2], pts[0]]);
    expect(lines[3].colors).toEqual([{ r: 0, g: 0, b: 1, a: 1 }, RED]);
  });

  it('pixel-sized lines and text get a fixed modest world size instead of metres of thickness', () => {
    const m = markers({ entities: [{ id: 'x', lines: [{ type: 0, pose: P, thickness: 4, scale_invariant: true, points: [xyz(0, 0), xyz(1, 0)] }], texts: [{ pose: P, font_size: 14, scale_invariant: true, text: 'hi', color: RED }] }] });
    expect(m[1].scale.x).toBeLessThan(0.1);
    expect(m[2].scale.z).toBeLessThan(1);
    expect(m[2]).toMatchObject({ type: MARKER_TYPE.TEXT_VIEW_FACING, text: 'hi' });
  });

  it('triangles are cut to whole triangles and indexed', () => {
    const v = [xyz(0, 0), xyz(1, 0), xyz(0, 1), xyz(5, 5)];
    const m = markers({ entities: [{ id: 't', triangles: [{ pose: P, color: RED, points: v }, { pose: P, color: RED, points: v, indices: [0, 1, 2, 3, 2, 1] }, { pose: P, points: v.slice(0, 2) }] }] });
    expect(m.slice(1)).toHaveLength(2);
    expect(m[1].points).toHaveLength(3); // the stray fourth vertex is dropped
    expect(m[2].points).toHaveLength(6);
    expect(m[1].type).toBe(MARKER_TYPE.TRIANGLE_LIST);
  });

  it('deletions: one entity by id, or everything; models are left out', () => {
    const m = markers({ deletions: [{ type: 0, id: 'gone' }, { type: 'MATCHING_ID', id: 'gone2' }, { type: 1, id: '' }], entities: [{ id: 'm', models: [{ pose: P }] }] });
    expect(m.map((x) => [x.ns, x.action])).toEqual([['gone', MARKER_ACTION_REPLACE_NAMESPACE], ['gone2', MARKER_ACTION_REPLACE_NAMESPACE], ['', 3], ['m', MARKER_ACTION_REPLACE_NAMESPACE]]);
  });

  it('survives junk: missing fields, wrong types, empty updates', () => {
    expect(markers({})).toEqual([]);
    expect(markers({ entities: [null, 5, {}, { id: 3, cubes: [null, {}], lines: 'no' }] }).length).toBeGreaterThan(0);
  });
});

describe('through a real MCAP into the marker renderer', () => {
  const T = (s: number) => BigInt(s) * 1_000_000_000n;
  const entity = (id: string, n: number, t = 1) => ({
    timestamp: { sec: t, nsec: 0 }, frame_id: 'map', id, lifetime: { sec: 0, nsec: 0 },
    cubes: Array.from({ length: n }, (_, i) => ({ pose: { position: xyz(i, 0), orientation: { x: 0, y: 0, z: 0, w: 1 } }, size: xyz(1, 1, 1), color: RED })),
  });

  async function bag() {
    const bytes = await writeJsonMcap([
      {
        topic: '/scene',
        schemaName: 'foxglove.SceneUpdate',
        messages: [
          { logTime: T(1), value: { entities: [entity('boxes', 3), entity('other', 2)] } },
          { logTime: T(2), value: { entities: [entity('boxes', 1, 2)] } }, // 'boxes' now has one cube; 'other' is untouched
          { logTime: T(3), value: { deletions: [{ type: 0, id: 'other' }] } },
          { logTime: T(4), value: { deletions: [{ type: 1, id: '' }] } },
        ],
      },
    ]);
    return createFileSource(new File([bytes], 'scene.mcap'));
  }

  it('is listed as a SceneUpdate topic and decodes to a MarkerArray', async () => {
    const s = await bag();
    const sum = await parseBag(s);
    expect(sum.topics[0]).toMatchObject({ name: '/scene', type: 'foxglove.SceneUpdate', messageCount: 4 });
    const m = await readMessageAtTime(s, 'mcap', '/scene', T(1));
    expect(extractMarkers(m!.value!, m!.timestamp).filter((x) => x.action === 0)).toHaveLength(5);
  });

  it('replaying the updates leaves exactly what Foxglove would show after each one', async () => {
    const s = await bag();
    await parseBag(s);
    const all = await readDeserializedMessages(s, 'mcap', '/scene');
    const set = new MarkerSet();
    const sizes: number[] = [];
    for (const msg of all) {
      for (const m of extractMarkers(msg.value!, msg.timestamp)) set.applyMarker(m);
      sizes.push(set.size());
    }
    // 3 + 2 cubes; 'boxes' replaced by one cube (1 + 2); 'other' deleted (1); everything deleted (0).
    expect(sizes).toEqual([5, 3, 1, 0]);
    expect(set.namespaces().sort()).toEqual(['boxes', 'other']);
  });

  it('a replaced entity with fewer primitives does not leave stale ones behind', () => {
    const set = new MarkerSet();
    const apply = (u: object) => {
      for (const m of extractMarkers({ markers: markers(u) }, 0n)) set.applyMarker(m);
    };
    apply({ entities: [entity('e', 10)] });
    expect(set.size()).toBe(10);
    apply({ entities: [entity('e', 0)] });
    expect(set.size()).toBe(0);
  });
});
