/**
 * Runs a guided tour against the live app: fetch and validate the file, make
 * sure the right bag is open, then apply each step (layout, time, playback).
 * Everything here calls existing store actions; a tour can do nothing a person
 * could not do by hand.
 */

import { useBagStore } from '../store/bagStore';
import { useLayoutStore } from '../store/layoutStore';
import { usePlayheadStore } from '../store/playheadStore';
import { useTourStore } from '../store/tourStore';
import { attachTypesAndPrune, parseTreeEncoding } from '../hooks/useUrlState';
import { parseTour, type Tour, type TourStep } from './tour';

export const SAMPLE_FILE_NAME = 'bagel-tour.mcap';

/** The tours that ship with BAGEL, each a file `public/tours/<id>.json` on the sample bag. */
export interface BundledTour {
  id: string;
  title: string;
  description: string;
}

export const BUNDLED_TOURS: readonly BundledTour[] = [
  { id: 'tf', title: 'What is TF?', description: 'Coordinate frames, and how one sensor reading is placed in the world.' },
  { id: 'laserscan', title: 'Reading a LaserScan', description: 'What the ranges array holds, and how it becomes points on screen.' },
  { id: 'timestamps', title: 'Why timestamps disagree', description: 'Sensors run at different rates; header stamps, log time and the playhead.' },
];

const base = () => import.meta.env.BASE_URL ?? '/';

export async function fetchSampleBag(): Promise<File> {
  const response = await fetch(`${base()}sample-bags/tour.mcap`);
  if (!response.ok) throw new Error(`could not download the sample bag (HTTP ${response.status})`);
  return new File([await response.blob()], SAMPLE_FILE_NAME, { type: 'application/octet-stream' });
}

/** Resolve a tour reference: a bundled id (`tf`), a path, or a full URL. */
export function tourUrl(ref: string): string {
  if (/^https?:\/\//.test(ref) || ref.startsWith('/')) return ref;
  return `${base()}tours/${encodeURIComponent(ref)}.json`;
}

/** Make the tour's bag the open one, without replacing a bag the person opened themselves. */
async function ensureBag(tour: Tour): Promise<string | null> {
  const bags = useBagStore.getState();
  const openName = bags.bag?.fileName ?? null;
  if (tour.bag === undefined) {
    return openName ? null : 'This tour works on whichever bag is open. Open a bag first, then start it again.';
  }
  if (tour.bag === 'sample') {
    if (openName === SAMPLE_FILE_NAME) return null;
    if (openName) return 'This tour uses the sample data. Close your bag, or open the sample, then start it again.';
    await bags.loadBag(await fetchSampleBag());
    return null;
  }
  if (openName) return null;
  await bags.loadBagFromUrl(tour.bag);
  return null;
}

/** Fetch, validate and start a tour. Failures land in the tour store, never as a throw. */
export async function startTourFromUrl(ref: string): Promise<void> {
  const store = useTourStore.getState();
  store.setLoading(true);
  try {
    const response = await fetch(tourUrl(ref));
    if (!response.ok) throw new Error(`the tour file could not be downloaded (HTTP ${response.status})`);
    let json: unknown;
    try {
      json = await response.json();
    } catch {
      throw new Error('the tour file is not valid JSON');
    }
    const parsed = parseTour(json);
    if (!parsed.ok) throw new Error(parsed.error);
    const problem = await ensureBag(parsed.tour);
    if (problem) throw new Error(problem);
    useTourStore.getState().start(parsed.tour);
  } catch (e) {
    useTourStore.getState().fail(`Could not start the tour: ${e instanceof Error ? e.message : String(e)}`);
  }
}

const HIGHLIGHT_ATTR = 'data-tour-highlight';

export function clearHighlight(): void {
  for (const el of document.querySelectorAll(`[${HIGHLIGHT_ATTR}]`)) el.removeAttribute(HIGHLIGHT_ATTR);
}

/** Put a step on screen: its layout, its moment, and whether it plays. Topics the bag lacks are skipped. */
export function applyTourStep(step: TourStep): void {
  clearHighlight();
  const bags = useBagStore.getState();

  if (step.layout) {
    const tree = parseTreeEncoding(step.layout);
    const topicTypes = new Map<string, Map<string, string>>();
    for (const [id, entry] of bags.bags) topicTypes.set(id, new Map(entry.summary.topics.map((t) => [t.name, t.type])));
    const resolved = attachTypesAndPrune(tree, topicTypes, bags.focusBagId);
    if (resolved) useLayoutStore.getState().restoreLayout(resolved);
  }

  const playhead = usePlayheadStore.getState();
  if (step.timeSec !== undefined) {
    const target = playhead.startNs + BigInt(Math.round(step.timeSec * 1e9));
    playhead.seek(target > playhead.endNs ? playhead.endNs : target);
  }
  playhead.setPlaying(step.play);

  if (step.highlight) {
    // A selector from a file someone else wrote: a bad one must not break the step.
    try {
      document.querySelector(step.highlight)?.setAttribute(HIGHLIGHT_ATTR, '');
    } catch {
      // ignore
    }
  }
}
