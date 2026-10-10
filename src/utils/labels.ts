/**
 * Timeline labels as data: the shape people keep in spreadsheets and feed to
 * training pipelines. Pure and DOM-free so the formats can be tested exactly.
 *
 * Times are the bag's own message clock in nanoseconds (what `ros2 bag` and
 * every parser here call timestamps), not the aligned playhead time, so a row
 * means the same instant whichever bag it is loaded next to.
 */

import type { Annotation } from '../store/annotationStore';

export interface LabelRow {
  bag: string;
  start_ns: string;
  /** Equal to `start_ns` for a plain bookmark. */
  end_ns: string;
  label: string;
  note: string;
}

/**
 * @param toBagNs converts an aligned time to the bag's own clock (see `bagLocalTimeFor`).
 *
 * Nanosecond values are strings: a 64-bit time does not survive a trip through
 * a JSON number or a spreadsheet's double.
 */
export function buildLabelRows(annotations: readonly Annotation[], bag: string, toBagNs: (alignedNs: bigint) => bigint): LabelRow[] {
  return [...annotations]
    .sort((a, b) => (a.timeNs < b.timeNs ? -1 : a.timeNs > b.timeNs ? 1 : 0))
    .map((a) => {
      const start = toBagNs(a.timeNs);
      const end = a.endNs !== undefined && a.endNs > a.timeNs ? toBagNs(a.endNs) : start;
      return { bag, start_ns: start.toString(), end_ns: end.toString(), label: a.label, note: a.note ?? '' };
    });
}

export function labelsToJson(rows: readonly LabelRow[]): string {
  return JSON.stringify(rows, null, 2) + '\n';
}

const COLUMNS: ReadonlyArray<keyof LabelRow> = ['bag', 'start_ns', 'end_ns', 'label', 'note'];

/**
 * One CSV cell. Quotes anything with a comma, quote or line break (doubling
 * quotes). A cell that a spreadsheet would run as a formula (`=`, `+`, `-`, `@`,
 * tab, carriage return at the start) gets a leading apostrophe: labels can come
 * from a shared link, and "=HYPERLINK(...)" must stay text. The JSON export is
 * the exact one.
 */
export function csvCell(value: string, numeric = false): string {
  let v = value;
  if (!numeric && /^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function labelsToCsv(rows: readonly LabelRow[]): string {
  const lines = [COLUMNS.join(',')];
  for (const row of rows) {
    lines.push(COLUMNS.map((c) => csvCell(row[c], c === 'start_ns' || c === 'end_ns')).join(','));
  }
  // CRLF is what spreadsheets and RFC 4180 expect.
  return lines.join('\r\n') + '\r\n';
}

/** A filename for the export: the bag's name without its extension, safe on every OS. */
export function labelsFileName(bag: string, ext: 'json' | 'csv'): string {
  const stem = bag.replace(/\.[^./\\]+$/, '').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^[_.]+|[_.]+$/g, '');
  return `${stem || 'bag'}-labels.${ext}`;
}
