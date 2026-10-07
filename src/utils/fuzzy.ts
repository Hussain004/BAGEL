/**
 * Fuzzy subsequence matcher for the command palette.
 *
 * Deliberately hand-rolled rather than pulling in a dependency. VS Code, fzf,
 * and Sublime all rank matches with a small set of tiers, and that ranking is
 * the entire user-visible behaviour of a palette, so it should be readable and
 * testable in-repo rather than hidden in a 40 KB package that also brings its
 * own opinions about rendering.
 *
 * The model is "every query character appears in the target, in order, with
 * bonuses for matching contiguously and at word starts". That is enough to
 * make `camimg` find `/camera/image_raw` and `copy` find `Copy link`, which
 * covers how people actually type into a palette: abbreviated, not spelled out.
 *
 * ## Why this is not a greedy scan
 *
 * The obvious implementation walks the target once, consuming a query
 * character whenever it matches. That is wrong in a way that shows up
 * constantly with ROS names. Scoring `raw` against `/camera/image_raw`
 * greedily takes the `r` in "ca**r**a" and ends up matching `r`, `a` then the
 * trailing `w` far away, scoring the same as a scattered `mra`. The `r` the
 * user obviously meant is the one in "ima**r**ew".
 *
 * So the scorer is a small dynamic program over (query position, target
 * position) that finds the best-scoring *alignment* rather than the first
 * greedy one. O(query x target) per candidate, which is nothing for the short
 * strings a palette sees, and the whole thing is about 40 lines.
 */

/** Score weights, higher is better. */
const SCORE = {
  /** Every query char present, in order. */
  subsequence: 1,
  /** Per character that extends a run with no gap. */
  contiguous: 14,
  /** Match starting at the very beginning of the target. */
  prefix: 24,
  /** Match starting right after a separator (a word boundary). */
  wordStart: 12,
  /** Small nudge for shorter targets, so an exact short name beats a long one. */
  shortBonus: 6,
} as const;

/** Characters treated as word boundaries for the word-start bonus. */
const SEPARATORS = new Set(['/', '_', '-', '.', ' ', ':']);

/**
 * Characters that are "the same" for matching purposes.
 *
 * The `/` and `_` matter more than they look: ROS topic names are full of both
 * (`/camera_rear/image_raw`), and someone who types `camera-front` should still
 * find `camera_front`. Keeping separators as their own characters (rather than
 * deleting them) means a match can still cross one to earn the word-start
 * bonus, which is what makes `camimg` find `/camera/image_raw`.
 */
function normalize(ch: string): string {
  if (SEPARATORS.has(ch)) return ch;
  return ch.toLowerCase();
}

/** Sentinel for "no alignment ends here". */
const UNREACHABLE = -Infinity;

/** Score for starting a fresh match (no previous matched query character). */
function startBonus(target: string[], index: number): number {
  if (index === 0) return SCORE.prefix;
  if (SEPARATORS.has(target[index - 1])) return SCORE.wordStart;
  return 0;
}

/**
 * Score `query` against `target`.
 *
 * Returns null when the query is not a subsequence of the target, which callers
 * treat as "no match". An empty query matches everything, letting callers keep
 * their own ordering for the unfiltered list.
 */
export function fuzzyScore(query: string, target: string): number | null {
  if (query.length === 0) return SCORE.subsequence + SCORE.shortBonus;

  const q = Array.from(query).map(normalize);
  const t = Array.from(target).map(normalize);

  // previous[j]: best score for an alignment of the query processed so far
  // whose final character matched t[j]. Running maxima are tracked alongside
  // so the "match anywhere earlier" transition is O(1) per cell.
  let previous = new Array<number>(t.length).fill(UNREACHABLE);
  let bestBefore = UNREACHABLE;
  let matchedAny = false;

  for (const queryChar of q) {
    const current = new Array<number>(t.length).fill(UNREACHABLE);
    let runningMax = UNREACHABLE;

    for (let j = 0; j < t.length; j++) {
      if (t[j] !== queryChar) {
        runningMax = Math.max(runningMax, previous[j]);
        continue;
      }

      // Option A: extend an existing run with this character.
      let best = UNREACHABLE;
      if (j > 0 && previous[j - 1] > UNREACHABLE) {
        best = previous[j - 1] + SCORE.contiguous;
      }
      // Option B: jump here from any earlier position (or start fresh).
      const jumpFrom = matchedAny ? bestBefore : UNREACHABLE;
      if (jumpFrom > UNREACHABLE) {
        best = Math.max(best, jumpFrom + SCORE.subsequence + startBonus(t, j));
      } else if (!matchedAny) {
        best = Math.max(best, SCORE.subsequence + startBonus(t, j));
      }

      current[j] = best;
      runningMax = Math.max(runningMax, best);
    }

    if (!current.some((v) => v > UNREACHABLE)) return null;
    previous = current;
    bestBefore = runningMax;
    matchedAny = true;
  }

  const alignmentScore = Math.max(...previous);
  if (alignmentScore === UNREACHABLE) return null;

  // Prefer tighter matches: the same alignment inside a shorter target is the
  // more specific hit. Capped so it can never outweigh a real match signal.
  return alignmentScore + Math.max(0, SCORE.shortBonus - Math.floor(t.length / 8));
}

export interface FuzzyMatch<T> {
  item: T;
  score: number;
}

/**
 * Filter and rank `items` by `keys`, highest score first.
 *
 * `limit` exists because the palette renders a fixed-height list: a bag with
 * 400 topics produces 800+ commands, and putting them all in the DOM costs more
 * than scrolling ever gets them out of. Ties keep the caller's original order,
 * which is what makes a deliberate declaration order survive filtering.
 */
export function fuzzyFilter<T>(
  items: T[],
  query: string,
  keys: (item: T) => string | string[],
  limit = 50,
): FuzzyMatch<T>[] {
  const trimmed = query.trim();
  if (trimmed.length === 0) return items.slice(0, limit).map((item) => ({ item, score: 0 }));

  const scored: { item: T; score: number; index: number }[] = [];
  items.forEach((item, index) => {
    const key = keys(item);
    const candidates = Array.isArray(key) ? key : [key];
    let best: number | null = null;
    for (const candidate of candidates) {
      const score = fuzzyScore(trimmed, candidate);
      if (score !== null && (best === null || score > best)) best = score;
    }
    if (best !== null) scored.push({ item, score: best, index });
  });

  scored.sort((a, b) => (b.score === a.score ? a.index - b.index : b.score - a.score));
  return scored.slice(0, limit).map(({ item, score }) => ({ item, score }));
}