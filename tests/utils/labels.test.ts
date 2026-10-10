import { describe, expect, it } from 'vitest';
import { buildLabelRows, csvCell, labelsFileName, labelsToCsv, labelsToJson } from '../../src/utils/labels';
import type { Annotation } from '../../src/store/annotationStore';

const A = (id: string, t: number, label: string, extra: Partial<Annotation> = {}): Annotation => ({ id, timeNs: BigInt(t), label, ...extra });
const same = (n: bigint) => n;

describe('buildLabelRows', () => {
  it('sorts by start, keeps ranges and points, and writes times as exact strings', () => {
    const big = 1_700_000_000_123_456_789n; // beyond a double's 53 bits
    const rows = buildLabelRows(
      [A('b', 5, 'later point'), { id: 'a', timeNs: big, endNs: big + 2_000_000_000n, label: 'turn', note: 'tight left' }, A('c', 1, 'first')],
      'run.mcap',
      same,
    );
    expect(rows.map((r) => r.label)).toEqual(['first', 'later point', 'turn']);
    expect(rows[2]).toEqual({ bag: 'run.mcap', start_ns: '1700000000123456789', end_ns: '1700000002123456789', label: 'turn', note: 'tight left' });
    // A point has end equal to start, and an empty note is an empty string.
    expect(rows[0]).toEqual({ bag: 'run.mcap', start_ns: '1', end_ns: '1', label: 'first', note: '' });
  });

  it('converts aligned times to the bag clock, ends included', () => {
    const rows = buildLabelRows([{ id: 'a', timeNs: 100n, endNs: 150n, label: 'x' }], 'b', (n) => n + 1_000n);
    expect(rows[0]).toMatchObject({ start_ns: '1100', end_ns: '1150' });
  });

  it('treats an end at or before the start as a point', () => {
    const rows = buildLabelRows([{ id: 'a', timeNs: 100n, endNs: 100n, label: 'x' }, { id: 'b', timeNs: 200n, endNs: 50n, label: 'y' }], 'b', same);
    expect(rows.map((r) => [r.start_ns, r.end_ns])).toEqual([['100', '100'], ['200', '200']]);
  });

  it('does not reorder or mutate the caller list', () => {
    const list = [A('b', 9, 'b'), A('a', 1, 'a')];
    buildLabelRows(list, 'x', same);
    expect(list.map((a) => a.id)).toEqual(['b', 'a']);
  });
});

describe('labelsToJson', () => {
  it('round-trips through JSON.parse with the exact columns', () => {
    const rows = buildLabelRows([A('a', 7, 'ünï "q"', { note: 'multi\nline' })], 'r.mcap', same);
    expect(JSON.parse(labelsToJson(rows))).toEqual(rows);
    expect(Object.keys(JSON.parse(labelsToJson(rows))[0])).toEqual(['bag', 'start_ns', 'end_ns', 'label', 'note']);
  });
});

describe('csv', () => {
  it('has a header and CRLF line ends', () => {
    expect(labelsToCsv(buildLabelRows([A('a', 1, 'x')], 'r', same))).toBe('bag,start_ns,end_ns,label,note\r\nr,1,1,x,\r\n');
    expect(labelsToCsv([])).toBe('bag,start_ns,end_ns,label,note\r\n');
  });

  it('quotes commas, quotes and line breaks, doubling inner quotes', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
    expect(csvCell('plain')).toBe('plain');
  });

  it('keeps spreadsheet formulas as text', () => {
    for (const bad of ['=SUM(A1:A9)', '+1', '-1+2', '@cmd', '\t=x', '=HYPERLINK("http://evil","x")']) {
      expect(csvCell(bad)).toMatch(/^"?'/);
    }
    expect(csvCell('=A1')).toBe("'=A1");
    expect(csvCell('safe = fine')).toBe('safe = fine');
  });

  it('does not touch the numeric columns', () => {
    const rows = buildLabelRows([A('a', 1, '-5 dB')], 'r', same);
    const [, line] = labelsToCsv(rows).split('\r\n');
    expect(line).toBe("r,1,1,'-5 dB,");
  });

  it('survives a hostile label end to end', () => {
    const rows = buildLabelRows([A('a', 1, '=cmd|\' /C calc\'!A0', { note: '"quoted", and,commas\r\nnewline' })], 'r', same);
    const csv = labelsToCsv(rows);
    // The note's own CRLF stays inside its quotes: the record is one record, not two.
    expect(csv.startsWith('bag,start_ns,end_ns,label,note\r\n')).toBe(true);
    expect(csv.endsWith('"\r\n')).toBe(true);
    expect(csv).toContain(`'=cmd|`);
    expect(csv).toContain('"""quoted"", and,commas\r\nnewline"');
  });
});

describe('labelsFileName', () => {
  it('drops the extension and anything unsafe', () => {
    expect(labelsFileName('run 01.mcap', 'csv')).toBe('run_01-labels.csv');
    expect(labelsFileName('../../etc/passwd.bag', 'json')).toBe('etc_passwd-labels.json');
    expect(labelsFileName('', 'json')).toBe('bag-labels.json');
    expect(labelsFileName('???', 'csv')).toBe('bag-labels.csv');
  });
});
