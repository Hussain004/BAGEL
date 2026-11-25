import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Frames of an IVF file: a 32-byte file header, then per frame a 4-byte size, an 8-byte pts and the payload. */
export function readIvf(name: string): { fourcc: string; frames: Uint8Array[] } {
  const buf = new Uint8Array(readFileSync(fileURLToPath(new URL(`./${name}.ivf`, import.meta.url))));
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const fourcc = String.fromCharCode(...buf.subarray(8, 12));
  const frames: Uint8Array[] = [];
  for (let i = view.getUint16(6, true); i + 12 <= buf.length; ) {
    const size = view.getUint32(i, true);
    frames.push(buf.slice(i + 12, i + 12 + size));
    i += 12 + size;
  }
  return { fourcc, frames };
}

export const KEYFRAMES: Record<string, number[]> = JSON.parse(
  readFileSync(fileURLToPath(new URL('./keyframes.json', import.meta.url)), 'utf8'),
);
