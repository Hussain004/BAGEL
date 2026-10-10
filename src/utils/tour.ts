/**
 * Guided tours: a JSON file that walks someone through a bag, one layout and
 * one moment at a time. An instructor writes the file, no code involved.
 *
 *   {
 *     "title": "What is TF?",
 *     "bag": "sample",                       // or a bag URL; omit to use whatever is open
 *     "steps": [
 *       {
 *         "title": "Frames",
 *         "body": "The robot has **frames**. See `/tf`.",
 *         "layout": "H(Ptf:%2Ftf,P3d:%2Flidar%2Fpoints)",   // same encoding as the URL hash `p=`
 *         "timeSec": 5,                       // seek here (seconds from the start)
 *         "highlight": "[aria-label=\"Timeline\"]",         // optional CSS selector to point at
 *         "play": false                       // default: paused, so there is time to read
 *       }
 *     ]
 *   }
 *
 * `parseTour` is the only door in: anything it returns is safe for the rest of
 * the app to use, and anything else comes back as a readable error naming the
 * step at fault.
 */

import { parseTreeEncoding } from '../hooks/useUrlState';

export interface TourStep {
  title: string;
  /** Plain text with `**bold**`, `` `code` `` and blank lines between paragraphs. Never HTML. */
  body: string;
  /** Layout in the URL hash's `p=` encoding; omitted keeps the current layout. */
  layout?: string;
  /** Seconds from the start of the bag to seek to; omitted keeps the playhead. */
  timeSec?: number;
  /** CSS selector of something to point at while this step shows. */
  highlight?: string;
  /** Start playing on arrival. Default false. */
  play: boolean;
}

export interface Tour {
  title: string;
  description?: string;
  /** `sample` (the bundled bag), or a bag URL; omitted means the bag that is already open. */
  bag?: string;
  steps: TourStep[];
}

export type TourParse = { ok: true; tour: Tour } | { ok: false; error: string };

export const MAX_STEPS = 50;
export const MAX_BODY = 2000;
const MAX_TITLE = 120;

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

function str(value: unknown, field: string, where: string, max: number, required: boolean): string | undefined | Error {
  if (value === undefined || value === null) return required ? new Error(`${where}: "${field}" is required`) : undefined;
  if (typeof value !== 'string') return new Error(`${where}: "${field}" must be text`);
  if (required && value.trim() === '') return new Error(`${where}: "${field}" is empty`);
  if (value.length > max) return new Error(`${where}: "${field}" is too long (${value.length} characters, the limit is ${max})`);
  return value;
}

export function parseTour(input: unknown): TourParse {
  const fail = (error: Error | string): TourParse => ({ ok: false, error: error instanceof Error ? error.message : error });
  if (!isObj(input)) return fail('A tour is a JSON object with a "title" and a list of "steps".');

  const title = str(input.title, 'title', 'Tour', MAX_TITLE, true);
  if (title instanceof Error) return fail(title);
  const description = str(input.description, 'description', 'Tour', MAX_BODY, false);
  if (description instanceof Error) return fail(description);
  const bag = str(input.bag, 'bag', 'Tour', 2000, false);
  if (bag instanceof Error) return fail(bag);
  if (bag !== undefined && bag !== 'sample' && !/^(https?:\/\/|\/)/.test(bag)) {
    return fail('Tour: "bag" must be "sample", an http(s) URL, or a path starting with "/"');
  }

  if (!Array.isArray(input.steps) || input.steps.length === 0) return fail('Tour: "steps" must be a list with at least one step');
  if (input.steps.length > MAX_STEPS) return fail(`Tour: too many steps (${input.steps.length}, the limit is ${MAX_STEPS})`);

  const steps: TourStep[] = [];
  for (let i = 0; i < input.steps.length; i++) {
    const where = `Step ${i + 1}`;
    const raw = input.steps[i];
    if (!isObj(raw)) return fail(`${where} must be an object with a "title" and a "body"`);

    const stepTitle = str(raw.title, 'title', where, MAX_TITLE, true);
    if (stepTitle instanceof Error) return fail(stepTitle);
    const body = str(raw.body, 'body', where, MAX_BODY, false);
    if (body instanceof Error) return fail(body);
    const layout = str(raw.layout, 'layout', where, 2000, false);
    if (layout instanceof Error) return fail(layout);
    if (layout !== undefined && parseTreeEncoding(layout) === null) {
      return fail(`${where}: "layout" is not a valid layout. Use the form H(Pplot:%2Fimu,P3d:%2Fscan), the same as the "p=" part of a BAGEL link`);
    }
    const highlight = str(raw.highlight, 'highlight', where, 200, false);
    if (highlight instanceof Error) return fail(highlight);

    let timeSec: number | undefined;
    if (raw.timeSec !== undefined) {
      if (typeof raw.timeSec !== 'number' || !Number.isFinite(raw.timeSec) || raw.timeSec < 0) {
        return fail(`${where}: "timeSec" must be a number of seconds, zero or more`);
      }
      timeSec = raw.timeSec;
    }
    if (raw.play !== undefined && typeof raw.play !== 'boolean') return fail(`${where}: "play" must be true or false`);

    steps.push({ title: stepTitle!, body: body ?? '', layout, timeSec, highlight, play: raw.play === true });
  }

  return { ok: true, tour: { title: title!, description, bag, steps } };
}

/** One inline piece of a tour body: plain, bold, or code. */
export type Inline = { kind: 'text' | 'bold' | 'code'; text: string };

/** Split a body into paragraphs of inline pieces. Anything else, `<` included, stays literal text. */
export function parseBody(body: string): Inline[][] {
  return body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const out: Inline[] = [];
      const re = /\*\*([^*]+)\*\*|`([^`]+)`/g;
      let last = 0;
      for (let m = re.exec(p); m; m = re.exec(p)) {
        if (m.index > last) out.push({ kind: 'text', text: p.slice(last, m.index) });
        out.push(m[1] !== undefined ? { kind: 'bold', text: m[1] } : { kind: 'code', text: m[2]! });
        last = m.index + m[0].length;
      }
      if (last < p.length) out.push({ kind: 'text', text: p.slice(last) });
      return out;
    });
}
