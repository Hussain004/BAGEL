/**
 * Stateful-dependency stress tests for db3.ts.
 *
 * `db3.ts` keeps one long-lived sql.js Database plus a per-topic decoded-
 * message LRU (`DB3_MESSAGE_CACHE_MAX_PER_TOPIC = 6`). A few one-shot
 * happy-path calls cannot catch LRU accounting bugs (missed MRU bumps,
 * over-eager eviction, cross-topic bleed), so this file drives many
 * sequential calls against the reused cached instance and checks results
 * against a test-side oracle plus reference identity of cached values.
 *
 * The sql.js mock matches `db3.test.ts`: db3.ts hard-codes a browser-
 * absolute `locateFile` that fails under Node unless the module is stubbed
 * to use sql.js's own dist/ lookup.
 */

import { describe, it, expect, beforeEach, vi, afterAll, beforeAll } from 'vitest';
import { MessageWriter } from '@foxglove/rosmsg2-serialization';

vi.mock('sql.js', async () => {
  const actual = await vi.importActual<typeof import('sql.js')>('sql.js');
  const init = actual.default;
  return {
    default: () => init(),
    __esModule: true,
  };
});

const {
  parseDb3,
  readRawMessagesDb3,
  readAllMessageStatsDb3,
  readMessageAtTimeDb3,
  disposeDb3Cache,
} = await import('../../src/parsers/db3');
const { createFileSource } = await import('../../src/parsers/source');
const { bytesToFile, collectMessageDefinitions, writeSyntheticDb3 } = await import(
  '../fixtures/synth'
);

// Fixture layout (all timestamps in ns):
//   /chatter  10 messages at 1s .. 10s, payload decodes to { data: 'hello <sec>' }
//   /ints      5 messages at 0.5s, 1.5s, 2.5s, 3.5s, 4.5s, payload { data: index }
//   /mystery   2 messages (arbitrary bytes, unregistered type -> value null)
const CHATTER_TIMES = Array.from({ length: 10 }, (_, i) => BigInt(i + 1) * 1_000_000_000n);
const INTS_TIMES = [0, 1, 2, 3, 4].map((i) => BigInt(i * 2 + 1) * 500_000_000n);
const MYSTERY_TIMES = [3_250_000_000n, 7_750_000_000n];

let fixtureBytes: Uint8Array;

beforeAll(async () => {
  const stringWriter = new MessageWriter(collectMessageDefinitions('std_msgs/msg/String'));
  const intWriter = new MessageWriter(collectMessageDefinitions('std_msgs/msg/Int32'));
  fixtureBytes = await writeSyntheticDb3([
    {
      topic: '/chatter',
      type: 'std_msgs/msg/String',
      messages: CHATTER_TIMES.map((t) => ({
        timestampNs: t,
        data: stringWriter.writeMessage({ data: `hello ${t / 1_000_000_000n}` }),
      })),
    },
    {
      topic: '/ints',
      type: 'std_msgs/msg/Int32',
      messages: INTS_TIMES.map((t, i) => ({
        timestampNs: t,
        data: intWriter.writeMessage({ data: i }),
      })),
    },
    {
      topic: '/mystery',
      type: 'pkg/Whatever',
      messages: MYSTERY_TIMES.map((t) => ({ timestampNs: t, data: new Uint8Array([7, 7]) })),
    },
  ]);
});

function fixtureSource(): ReturnType<typeof createFileSource> {
  return createFileSource(bytesToFile(fixtureBytes, 'stress.db3'));
}

/**
 * Independent nearest-message oracle. Mirrors the UNION query's row order:
 * first row `>= target` is visited first, then the last row `< target`;
 * a candidate only replaces the current best when STRICTLY closer, so exact
 * ties keep the `>= target` row.
 */
function nearestOracle(times: bigint[], target: bigint): bigint | undefined {
  const firstGe = times.find((t) => t >= target);
  const lastLt = [...times].reverse().find((t) => t < target);
  let best: bigint | undefined;
  let bestDist: bigint | undefined;
  for (const cand of [firstGe, lastLt]) {
    if (cand === undefined) continue;
    const dist = cand > target ? cand - target : target - cand;
    if (bestDist === undefined || dist < bestDist) {
      best = cand;
      bestDist = dist;
    }
  }
  return best;
}

function expectedValue(topic: string, ts: bigint): Record<string, unknown> | null {
  if (topic === '/chatter') return { data: `hello ${ts / 1_000_000_000n}` };
  if (topic === '/ints') return { data: Number((ts - 500_000_000n) / 1_000_000_000n) };
  return null; // /mystery: unregistered type decodes to null
}

const TOPIC_ORACLES: Array<{ topic: string; times: bigint[] }> = [
  { topic: '/chatter', times: CHATTER_TIMES },
  { topic: '/ints', times: INTS_TIMES },
  { topic: '/mystery', times: MYSTERY_TIMES },
];

beforeEach(() => disposeDb3Cache());
afterAll(() => disposeDb3Cache());

describe('db3 stress: sequential readMessageAtTimeDb3', () => {
  it('matches a test-side nearest-message oracle over 60+ interleaved calls', async () => {
    const source = fixtureSource();
    await parseDb3(source);
    let calls = 0;
    // 72 iterations across three topics with irregular targets, plus fixed
    // edge probes (before the first message, after the last one).
    const targets: Array<{ topic: string; t: bigint }> = [];
    for (let i = 0; i < 72; i++) {
      const { topic, times } = TOPIC_ORACLES[i % TOPIC_ORACLES.length];
      const spanNs = times[times.length - 1] + 2_000_000_000n;
      const t = (BigInt((i * 137) % 10_501) * 1_000_000_000n) % spanNs;
      targets.push({ topic, t });
    }
    targets.push({ topic: '/chatter', t: 0n });
    targets.push({ topic: '/chatter', t: 999_000_000_000n });
    targets.push({ topic: '/ints', t: 4_200_000_000n }); // between 3.5s and 4.5s

    for (const { topic, t } of targets) {
      const times = TOPIC_ORACLES.find((o) => o.topic === topic)!.times;
      const expectedTs = nearestOracle(times, t);
      const message = await readMessageAtTimeDb3(source, topic, t);
      calls++;
      expect(message, `${topic} @ ${t}`).not.toBeNull();
      expect(message!.timestamp, `${topic} @ ${t}`).toBe(expectedTs);
      const expected = expectedValue(topic, message!.timestamp);
      if (expected === null) {
        expect(message!.value).toBeNull();
      } else {
        expect(message!.value).toEqual(expected);
      }
    }
    expect(calls).toBeGreaterThanOrEqual(60);
  });

  it('evicts by LRU order once the per-topic bound (6) is exceeded', async () => {
    const source = fixtureSource();
    await parseDb3(source);

    // Fill the /chatter cache to exactly its bound: 1s..6s.
    const refs = new Map<bigint, Record<string, unknown> | null>();
    for (const ts of CHATTER_TIMES.slice(0, 6)) {
      const m = await readMessageAtTimeDb3(source, '/chatter', ts);
      refs.set(ts, m!.value);
    }
    // Every first access is a miss -> six distinct decoded objects.
    expect(new Set(refs.values()).size).toBe(6);

    // Hit 1s: same reference, and the hit bumps it to MRU.
    const hit = await readMessageAtTimeDb3(source, '/chatter', CHATTER_TIMES[0]);
    expect(hit!.value).toBe(refs.get(CHATTER_TIMES[0]));

    // 7th distinct timestamp misses -> evicts the LRU entry (2s), not 1s.
    const seventh = await readMessageAtTimeDb3(source, '/chatter', CHATTER_TIMES[6]);
    expect(seventh!.value).toEqual({ data: 'hello 7' });
    // 1s survived the eviction (it was bumped to MRU).
    const stillCached = await readMessageAtTimeDb3(source, '/chatter', CHATTER_TIMES[0]);
    expect(stillCached!.value).toBe(refs.get(CHATTER_TIMES[0]));
    // 2s was the LRU victim: a fresh decode produces a new object...
    const evicted = await readMessageAtTimeDb3(source, '/chatter', CHATTER_TIMES[1]);
    expect(evicted!.value).not.toBe(refs.get(CHATTER_TIMES[1]));
    // ...but the re-decoded content is still correct.
    expect(evicted!.value).toEqual({ data: 'hello 2' });

    // The bound never grows: cycle every distinct timestamp again, then
    // confirm the newest entry still short-circuits the decode while an
    // entry that got evicted along the way re-decodes to a fresh object.
    for (const ts of CHATTER_TIMES.slice(2)) {
      await readMessageAtTimeDb3(source, '/chatter', ts);
    }
    const recent = await readMessageAtTimeDb3(source, '/chatter', CHATTER_TIMES[9]);
    const recentRef = recent!.value;
    expect(recentRef).toEqual({ data: 'hello 10' });
    // 4s was the last entry evicted during the cycle above, so this access
    // is a miss: a new object, not the original decode.
    const mid = await readMessageAtTimeDb3(source, '/chatter', CHATTER_TIMES[3]);
    expect(mid!.value).not.toBe(refs.get(CHATTER_TIMES[3]));
    expect(mid!.value).toEqual({ data: 'hello 4' });
    // Re-hit the newest entry to prove the map still short-circuits decode.
    const again = await readMessageAtTimeDb3(source, '/chatter', CHATTER_TIMES[9]);
    expect(again!.value).toBe(recentRef);
  });

  it('isolates per-topic caches from each other', async () => {
    const source = fixtureSource();
    await parseDb3(source);

    // Fill /chatter to its bound and remember one reference.
    const anchors: Array<{ ts: bigint; value: Record<string, unknown> | null }> = [];
    for (const ts of CHATTER_TIMES.slice(0, 6)) {
      const m = await readMessageAtTimeDb3(source, '/chatter', ts);
      anchors.push({ ts, value: m!.value });
    }

    // Hammer the other two topics well past /chatter's bound size.
    for (let round = 0; round < 3; round++) {
      for (const ts of INTS_TIMES) await readMessageAtTimeDb3(source, '/ints', ts);
      for (const ts of MYSTERY_TIMES) await readMessageAtTimeDb3(source, '/mystery', ts);
    }

    // /chatter's cached entries must be untouched by the other topics' traffic.
    for (const anchor of anchors) {
      const m = await readMessageAtTimeDb3(source, '/chatter', anchor.ts);
      expect(m!.value, `chatter @ ${anchor.ts}`).toBe(anchor.value);
    }
    // And the /ints cache filled up independently with its own values.
    const intsMid = await readMessageAtTimeDb3(source, '/ints', INTS_TIMES[2]);
    expect(intsMid!.value).toEqual({ data: 2 });
  });
});

describe('db3 stress: repeated bulk reads', () => {
  it('stays byte-identical across 50 repeated raw + stats reads', async () => {
    const source = fixtureSource();
    await parseDb3(source);

    const firstRaw = await readRawMessagesDb3(source, '/chatter');
    const firstStats = await readAllMessageStatsDb3(source);
    const firstRawView = firstRaw.map((r) => [r.timestamp, Array.from(r.data)] as const);
    const firstStatsView = Object.fromEntries(
      Object.entries(firstStats).map(([topic, s]) => [
        topic,
        { times: Array.from(s.times), sizes: Array.from(s.sizes) },
      ]),
    );

    for (let i = 0; i < 50; i++) {
      const raw = await readRawMessagesDb3(source, '/chatter');
      expect(raw.map((r) => [r.timestamp, Array.from(r.data)] as const)).toEqual(firstRawView);

      const stats = await readAllMessageStatsDb3(source);
      const statsView = Object.fromEntries(
        Object.entries(stats).map(([topic, s]) => [
          topic,
          { times: Array.from(s.times), sizes: Array.from(s.sizes) },
        ]),
      );
      expect(statsView).toEqual(firstStatsView);

      // Interleave a decoded read so the bulk reads also exercise coexistence
      // with the LRU cache rather than running in isolation.
      const mid = CHATTER_TIMES[i % CHATTER_TIMES.length];
      const m = await readMessageAtTimeDb3(source, '/chatter', mid);
      expect(m).not.toBeNull();
    }

    expect(firstRaw).toHaveLength(10);
    expect(Object.keys(firstStats).sort()).toEqual(['/chatter', '/ints', '/mystery']);
  });
});
