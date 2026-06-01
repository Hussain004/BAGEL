import { describe, it, expect } from 'vitest';
import { formatFileSize, toHexDump, checkMagicBytes } from '../../src/utils/bytes';

describe('bytes/formatFileSize', () => {
  it('reports bytes for sub-KB sizes with no decimal', () => {
    expect(formatFileSize(0)).toBe('0 B');
    expect(formatFileSize(512)).toBe('512 B');
    expect(formatFileSize(1023)).toBe('1023 B');
  });

  it('rolls over to KB / MB / GB with one decimal', () => {
    expect(formatFileSize(1024)).toBe('1.0 KB');
    expect(formatFileSize(1024 * 1024)).toBe('1.0 MB');
    expect(formatFileSize(1024 * 1024 * 1024)).toBe('1.0 GB');
  });

  it('caps at the largest configured unit', () => {
    expect(formatFileSize(1024 ** 6)).toMatch(/TB$/);
  });

  it('rounds to one decimal in the chosen unit', () => {
    expect(formatFileSize(1536)).toBe('1.5 KB');
    expect(formatFileSize(2.5 * 1024 * 1024)).toBe('2.5 MB');
  });
});

describe('bytes/toHexDump', () => {
  it('produces a canonical hex+ASCII dump', () => {
    const dump = toHexDump(new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]));
    expect(dump).toContain('48 65 6c 6c 6f');
    expect(dump).toContain('Hello');
    expect(dump.startsWith('00000000')).toBe(true);
  });

  it('marks non-printable bytes with dots', () => {
    const dump = toHexDump(new Uint8Array([0x00, 0x01, 0x02, 0x41]));
    expect(dump).toContain('...A');
  });

  it('truncates and appends a "(N more)" line when over maxBytes', () => {
    const big = new Uint8Array(512);
    const dump = toHexDump(big, 64);
    expect(dump).toMatch(/\(448 more bytes\)/);
  });
});

describe('bytes/checkMagicBytes', () => {
  // MCAP magic: 0x89 'M' 'C' 'A' 'P' '0' '\r' '\n'
  const MCAP = [0x89, 0x4d, 0x43, 0x41, 0x50, 0x30, 0x0d, 0x0a];

  it('matches a known prefix', () => {
    const buf = new Uint8Array([...MCAP, 0x00, 0x01]);
    expect(checkMagicBytes(buf, MCAP)).toBe(true);
  });

  it('rejects when the prefix differs', () => {
    const buf = new Uint8Array([0xff, ...MCAP.slice(1)]);
    expect(checkMagicBytes(buf, MCAP)).toBe(false);
  });

  it('rejects when the buffer is shorter than the magic', () => {
    expect(checkMagicBytes(new Uint8Array([0x89]), MCAP)).toBe(false);
  });

  it('handles an empty magic array as a vacuous true', () => {
    expect(checkMagicBytes(new Uint8Array([0x00]), [])).toBe(true);
  });
});
