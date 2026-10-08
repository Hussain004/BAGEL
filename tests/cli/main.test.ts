import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { run } from '../../cli/main';
import { chatterBag, writeSyntheticDb3, writeSyntheticMcap } from '../fixtures/synth';

vi.mock('sql.js', async () => {
  const actual = await vi.importActual<typeof import('sql.js')>('sql.js');
  return { default: () => actual.default(), __esModule: true };
});

const BUNDLE = join(__dirname, '../../cli/bundle/bagel-check.mjs');
let dir: string;
const file = (name: string, bytes: Uint8Array, sub = '') => {
  mkdirSync(join(dir, sub), { recursive: true });
  const p = join(dir, sub, name);
  writeFileSync(p, bytes);
  return p;
};
const rules = (o: object) => file(`rules${Math.random()}.json`, new TextEncoder().encode(JSON.stringify(o)));

async function cli(...argv: string[]) {
  let out = '';
  let err = '';
  const code = await run(argv, { out: (s) => (out += s), err: (s) => (err += s) });
  return { code, out, err };
}

// /a at 10 Hz for 2 s with a 1 s silence in the middle of /b.
const twoTopics = (offsetS = 0) =>
  writeSyntheticMcap([
    {
      topic: '/a',
      type: 'std_msgs/msg/String',
      messages: Array.from({ length: 21 }, (_, i) => ({ logTime: BigInt(Math.round((offsetS + i * 0.1) * 1e9)), value: { data: 'x' } })),
    },
    {
      topic: '/b',
      type: 'std_msgs/msg/Int32',
      messages: [0, 0.5, 1.5, 2].map((t) => ({ logTime: BigInt(Math.round((offsetS + t) * 1e9)), value: { data: 1 } })),
    },
  ]);

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'bagel-check-'));
});

describe('run', () => {
  it('exits 0 and prints a table with no rules', async () => {
    const r = await cli(file('plain.mcap', await chatterBag()));
    expect(r.code).toBe(0);
    expect(r.out).toContain('PASS  plain.mcap');
    expect(r.out).toContain('/chatter');
  });

  it('exits 1 with the failing rule when a gap rule is broken', async () => {
    const bag = file('gappy.mcap', await twoTopics());
    const ok = await cli('--expect', rules({ topics: { '/a': { min_hz: 9, max_gap_s: 0.2 } } }), bag);
    expect(ok.code).toBe(0);
    const bad = await cli('--expect', rules({ topics: { '/a': { min_hz: 9 }, '/b': { max_gap_s: 0.6 } } }), bag);
    expect(bad.code).toBe(1);
    expect(bad.out).toContain('FAIL  gappy.mcap');
    expect(bad.out).toContain('x /b: longest gap 1 s');
  });

  it('emits JSON and a markdown summary file', async () => {
    const bag = file('j.mcap', await chatterBag());
    const md = join(dir, 'out.md');
    const r = await cli('--json', '--summary', md, '--expect', rules({ topics: { '/nope': {} } }), bag);
    expect(r.code).toBe(1);
    const parsed = JSON.parse(r.out);
    expect(parsed[0]).toMatchObject({ name: 'j.mcap', passed: false });
    expect(parsed[0].checks).toEqual([{ ok: false, subject: '/nope', message: 'topic is missing' }]);
    expect(readFileSync(md, 'utf8')).toContain('### FAIL: `j.mcap`');
  });

  it('treats a folder of numbered parts as one recording', async () => {
    file('rec_0.mcap', await twoTopics(0), 'split');
    file('rec_1.mcap', await twoTopics(10), 'split');
    const r = await cli('--json', join(dir, 'split'));
    const parsed = JSON.parse(r.out);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe('rec (2 parts)');
    expect(parsed[0].duration_s).toBeCloseTo(12, 1);
    const a = parsed[0].topics.find((t: { topic: string }) => t.topic === '/a');
    expect(a.count).toBe(42);
    // The 8 s hole between the parts is what the gap rule is for.
    const gap = await cli('--expect', rules({ topics: { '/a': { max_gap_s: 1 } } }), join(dir, 'split'));
    expect(gap.code).toBe(1);
  });

  it('exits 2 for usage errors and unreadable bags, never 0 or 1', async () => {
    expect((await cli()).code).toBe(2);
    expect((await cli('--bogus', 'x')).code).toBe(2);
    expect((await cli(join(dir, 'missing.mcap'))).code).toBe(2);
    expect((await cli('--expect', rules({ typo: 1 }), file('t.mcap', await chatterBag()))).code).toBe(2);
    expect((await cli(file('junk.mcap', new Uint8Array(64).fill(7)))).code).toBe(2);
    const empty = join(dir, 'empty');
    mkdirSync(empty);
    expect((await cli(empty)).err).toContain('no .mcap, .db3 or .bag files found');
  });
});

// The shipped artifact, not the TypeScript: this is what the GitHub Action runs.
describe('committed bundle', () => {
  it('opens an mcap and applies rules', async () => {
    const bag = file('b.mcap', await twoTopics());
    const r = spawnSync('node', [BUNDLE, '--expect', rules({ topics: { '/a': { min_hz: 20 } } }), bag], { encoding: 'utf8' });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('/a: ');
  });

  it('opens a .db3 (sql.js wasm found next to the bundle)', async () => {
    const enc = new TextEncoder();
    // CDR std_msgs/String: 4-byte header, length 3 ("hi\0"), then the bytes.
    const data = new Uint8Array([0, 1, 0, 0, 3, 0, 0, 0, ...enc.encode('hi'), 0]);
    const bytes = await writeSyntheticDb3([
      { topic: '/chatter', type: 'std_msgs/msg/String', messages: [1, 2, 3].map((s) => ({ timestampNs: BigInt(s) * 1_000_000_000n, data })) },
    ]);
    const out = execFileSync('node', [BUNDLE, '--json', file('d.db3', bytes)], { encoding: 'utf8' });
    const parsed = JSON.parse(out);
    expect(parsed[0].topics[0]).toMatchObject({ topic: '/chatter', count: 3 });
  });
});
