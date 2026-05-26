/**
 * Topic data export — CSV (flat numeric) and JSON (full deserialized) writers.
 *
 * Both formats stream through an in-memory string then a Blob; for huge
 * topics that's fine on modern browsers (a 50k-row CSV with 20 columns
 * weighs in around 20 MB, well under the Blob limit). If we ever need to
 * support multi-million-row exports we'd switch to a streamed File System
 * Access write — for now keep it simple.
 *
 * Bigints in deserialized messages serialise as `"123n"` strings in JSON so
 * the file is still valid JSON and the precision survives round-trips. The
 * receiver is expected to parse those back as needed.
 */

import type { DecodedMessage } from '../hooks/useTopicMessages';
import { flattenNumeric } from './messages';

export type ExportFormat = 'csv' | 'json';

/**
 * CSV of flattened numeric fields.
 *
 * Columns are the union of every numeric leaf field across all messages,
 * sorted alphabetically. Missing values render as empty cells. Time is
 * provided in two columns — absolute (`time_ns`) and relative seconds from
 * the first message (`t_s`) — because both are useful in different tools.
 */
export function toCsv(messages: DecodedMessage[]): string {
  if (messages.length === 0) return 'time_ns,t_s\n';

  // Pass 1: collect the union of numeric leaf fields.
  const fieldSet = new Set<string>();
  const flats: Record<string, number>[] = new Array(messages.length);
  for (let i = 0; i < messages.length; i++) {
    const flat = flattenNumeric(messages[i].value);
    flats[i] = flat;
    for (const k of Object.keys(flat)) fieldSet.add(k);
  }
  const fields = Array.from(fieldSet).sort();

  const header = ['time_ns', 't_s', ...fields].map(csvEscape).join(',');
  const baseNs = messages[0].timestamp;
  const lines: string[] = [header];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    const tSec = Number(m.timestamp - baseNs) / 1e9;
    const row: string[] = [m.timestamp.toString(), tSec.toString()];
    const flat = flats[i];
    for (const f of fields) {
      const v = flat[f];
      row.push(v === undefined ? '' : String(v));
    }
    lines.push(row.map(csvEscape).join(','));
  }
  return lines.join('\n') + '\n';
}

/** RFC 4180-ish CSV escape — wraps values containing commas/quotes/newlines. */
function csvEscape(value: string): string {
  if (value === '') return '';
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Full deserialized JSON dump. Each line is one message:
 *   { "timestamp": "1700000000000000000n", "value": { ... } }
 *
 * NDJSON (one object per line) instead of a single big array so the file
 * can be streamed line-by-line in downstream tools like jq or DuckDB.
 */
export function toNdjson(messages: DecodedMessage[]): string {
  const lines: string[] = new Array(messages.length);
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    const obj = {
      timestamp_ns: m.timestamp.toString(),
      value: m.value,
    };
    lines[i] = JSON.stringify(obj, jsonBigintReplacer);
  }
  return lines.join('\n') + '\n';
}

/** Serialise BigInts and Uint8Arrays so JSON.stringify doesn't throw. */
function jsonBigintReplacer(_key: string, value: unknown): unknown {
  if (typeof value === 'bigint') return `${value.toString()}n`;
  if (value instanceof Uint8Array) {
    // Base64 keeps binary fields (image data, raw bytes) compact in JSON.
    return { __bytes_b64: bytesToBase64(value), length: value.length };
  }
  return value;
}

function bytesToBase64(bytes: Uint8Array): string {
  // Build the binary string in chunks so we don't blow the JS engine's
  // argument-count limit on long arrays.
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, i + CHUNK);
    bin += String.fromCharCode(...slice);
  }
  return btoa(bin);
}

/**
 * Trigger a browser download for `text` with the given filename. Returns a
 * cleanup function for the object URL, though the browser GCs them quickly.
 */
export function downloadText(text: string, filename: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Defer revocation so the browser actually completes the download —
  // immediate revoke can cancel mid-flight on Chromium.
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/**
 * Build a safe filename from a topic name + the bag's stem + a format suffix.
 * Forward slashes and other path characters are replaced with `_`.
 */
export function makeExportFilename(
  bagFileName: string,
  topicName: string,
  format: ExportFormat,
): string {
  const bagStem = bagFileName.replace(/\.[^.]+$/, '');
  const topicStem = topicName.replace(/^\/+/, '').replace(/[^a-zA-Z0-9._-]+/g, '_');
  const ext = format === 'csv' ? 'csv' : 'ndjson';
  return `${bagStem}__${topicStem}.${ext}`;
}
