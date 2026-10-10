/**
 * The tours that ship with BAGEL must keep working as the sample bag changes:
 * each file is valid, each is listed, and every panel a step opens names a topic
 * the sample bag really has (a step that opens nothing teaches nothing).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseTour } from '../../src/utils/tour';
import { BUNDLED_TOURS } from '../../src/utils/tourRunner';
import { parseTreeEncoding } from '../../src/hooks/useUrlState';
import { parseBag } from '../../src/parsers/core';
import { createFileSource } from '../../src/parsers/source';
import type { LayoutNode } from '../../src/store/layoutStore';

const dir = resolve(__dirname, '../../public/tours');
const ids = readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));

function topicsOf(node: LayoutNode | null): string[] {
  if (!node) return [];
  return node.node === 'panel' ? [node.topicName] : node.children.flatMap(topicsOf);
}

describe('bundled tours', () => {
  it('every file is listed, and every listed tour has a file', () => {
    expect(ids.sort()).toEqual(BUNDLED_TOURS.map((t) => t.id).sort());
  });

  for (const id of ids) {
    describe(id, () => {
      const json = JSON.parse(readFileSync(resolve(dir, `${id}.json`), 'utf8'));

      it('is a valid tour on the sample bag, with the listed title', () => {
        const parsed = parseTour(json);
        expect(parsed.ok, parsed.ok ? '' : parsed.error).toBe(true);
        if (parsed.ok) {
          expect(parsed.tour.bag).toBe('sample');
          expect(parsed.tour.title).toBe(BUNDLED_TOURS.find((t) => t.id === id)!.title);
          expect(parsed.tour.steps.length).toBeGreaterThanOrEqual(3);
        }
      });

      it('only opens topics the sample bag has, and only seeks inside its 30 seconds', async () => {
        const parsed = parseTour(json);
        if (!parsed.ok) throw new Error(parsed.error);
        const file = new File([readFileSync(resolve(__dirname, '../../public/sample-bags/tour.mcap'))], 'bagel-tour.mcap');
        const summary = await parseBag(createFileSource(file));
        const have = new Set(summary.topics.map((t) => t.name));
        for (const [i, step] of parsed.tour.steps.entries()) {
          for (const topic of topicsOf(step.layout ? parseTreeEncoding(step.layout) : null)) {
            expect(have.has(topic), `step ${i + 1} opens ${topic}, which the sample bag does not have`).toBe(true);
          }
          if (step.timeSec !== undefined) expect(step.timeSec).toBeLessThanOrEqual(summary.duration);
        }
      });
    });
  }
});
