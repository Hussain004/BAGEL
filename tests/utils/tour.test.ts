import { describe, expect, it } from 'vitest';
import { MAX_BODY, MAX_STEPS, parseBody, parseTour } from '../../src/utils/tour';

const step = (extra: Record<string, unknown> = {}) => ({ title: 'A step', body: 'Hello', ...extra });
const tour = (extra: Record<string, unknown> = {}) => ({ title: 'T', steps: [step()], ...extra });
const error = (input: unknown) => {
  const r = parseTour(input);
  if (r.ok) throw new Error('expected a failure');
  return r.error;
};

describe('parseTour', () => {
  it('accepts a minimal tour and fills defaults', () => {
    const r = parseTour(tour());
    expect(r.ok && r.tour.steps[0]).toEqual({ title: 'A step', body: 'Hello', layout: undefined, timeSec: undefined, highlight: undefined, play: false });
  });

  it('accepts every field', () => {
    const r = parseTour({
      title: 'What is TF?',
      description: 'Frames',
      bag: 'sample',
      steps: [step({ layout: 'H(Ptf:%2Ftf,P3d:%2Fscan)', timeSec: 12.5, highlight: '#timeline-track', play: true })],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.tour.bag).toBe('sample');
      expect(r.tour.steps[0]).toMatchObject({ layout: 'H(Ptf:%2Ftf,P3d:%2Fscan)', timeSec: 12.5, play: true });
    }
  });

  it('accepts a bag URL or a path, and nothing else', () => {
    expect(parseTour(tour({ bag: 'https://example.com/run.mcap' })).ok).toBe(true);
    expect(parseTour(tour({ bag: '/sample-bags/tour.mcap' })).ok).toBe(true);
    expect(error(tour({ bag: 'file:///etc/passwd' }))).toMatch(/"bag" must be/);
    expect(error(tour({ bag: 'javascript:alert(1)' }))).toMatch(/"bag" must be/);
  });

  it('names the step at fault', () => {
    expect(error({ title: 'T', steps: [step(), { body: 'no title' }] })).toBe('Step 2: "title" is required');
    expect(error({ title: 'T', steps: [step(), step({ title: '   ' })] })).toBe('Step 2: "title" is empty');
    expect(error({ title: 'T', steps: [step({ body: 5 })] })).toBe('Step 1: "body" must be text');
    expect(error({ title: 'T', steps: [step(), step(), 'x'] })).toMatch(/^Step 3 must be an object/);
  });

  it('rejects a layout that does not parse, with a hint at the right form', () => {
    for (const layout of ['', 'nonsense', 'H(', 'Xplot:%2Fa']) {
      // An empty string is "present but empty": it is not a layout either.
      const e = error({ title: 'T', steps: [step({ layout })] });
      expect(e).toMatch(/Step 1: "layout" is not a valid layout/);
      expect(e).toMatch(/H\(Pplot/);
    }
  });

  it('rejects bad times and flags', () => {
    for (const timeSec of [-1, '5', NaN, Infinity, false]) {
      expect(error({ title: 'T', steps: [step({ timeSec })] })).toMatch(/"timeSec" must be a number/);
    }
    expect(error({ title: 'T', steps: [step({ play: 'yes' })] })).toMatch(/"play" must be true or false/);
    expect(parseTour({ title: 'T', steps: [step({ timeSec: 0 })] }).ok).toBe(true);
  });

  it('rejects a tour that is not an object, has no title, or has no steps', () => {
    for (const bad of [null, undefined, 'x', 5, [], [tour()]]) expect(error(bad)).toMatch(/JSON object/);
    expect(error({ steps: [step()] })).toBe('Tour: "title" is required');
    expect(error({ title: 'T' })).toMatch(/"steps" must be a list/);
    expect(error({ title: 'T', steps: [] })).toMatch(/at least one step/);
    expect(error({ title: 'T', steps: 'no' })).toMatch(/"steps" must be a list/);
  });

  it('caps the number of steps and the size of text so a hostile file cannot flood the page', () => {
    expect(error({ title: 'T', steps: Array.from({ length: MAX_STEPS + 1 }, () => step()) })).toMatch(/too many steps/);
    expect(parseTour({ title: 'T', steps: Array.from({ length: MAX_STEPS }, () => step()) }).ok).toBe(true);
    expect(error({ title: 'T', steps: [step({ body: 'x'.repeat(MAX_BODY + 1) })] })).toMatch(/"body" is too long/);
    expect(error({ title: 'x'.repeat(500), steps: [step()] })).toMatch(/"title" is too long/);
  });

  it('ignores unknown fields instead of failing, so tours can carry notes', () => {
    const r = parseTour({ ...tour(), author: 'me', steps: [step({ note: 'hi' })] });
    expect(r.ok).toBe(true);
    if (r.ok) expect('note' in r.tour.steps[0]!).toBe(false);
  });
});

describe('parseBody', () => {
  it('splits paragraphs and marks bold and code', () => {
    expect(parseBody('One **two** and `three`.\n\nSecond paragraph')).toEqual([
      [
        { kind: 'text', text: 'One ' },
        { kind: 'bold', text: 'two' },
        { kind: 'text', text: ' and ' },
        { kind: 'code', text: 'three' },
        { kind: 'text', text: '.' },
      ],
      [{ kind: 'text', text: 'Second paragraph' }],
    ]);
  });

  it('keeps markup-looking text literal: nothing in a body is ever HTML', () => {
    const [[piece]] = parseBody('<img src=x onerror=alert(1)> <script>x</script>');
    expect(piece).toEqual({ kind: 'text', text: '<img src=x onerror=alert(1)> <script>x</script>' });
  });

  it('handles empty, unbalanced and adjacent markers', () => {
    expect(parseBody('')).toEqual([]);
    expect(parseBody('  \n\n ')).toEqual([]);
    expect(parseBody('a ** b `c')[0]).toEqual([{ kind: 'text', text: 'a ** b `c' }]);
    expect(parseBody('**a**`b`')[0]).toEqual([{ kind: 'bold', text: 'a' }, { kind: 'code', text: 'b' }]);
  });
});
