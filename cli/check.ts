/**
 * Pass/fail checks for a recording, for CI.
 *
 * "Did the robot actually record what it should have?" is cheap to answer from
 * the topic list and message times, so a recording gate can run in a pipeline
 * without a browser. Everything here is pure (no filesystem, no process) so the
 * rules can be tested exactly; `main.ts` does the I/O.
 *
 * The expectations file is strict JSON: an unknown key is an error, because a
 * typo like `min_hz_` silently checking nothing is how a gate goes green while
 * the bag is bad.
 */

import type { AllTopicStats, BagSummary } from '../src/types/bag';
import { normalizeType } from '../src/utils/bagDiff';
import { computeTopicHealth } from '../src/utils/topicStats';

export class UsageError extends Error {}

export interface TopicRule {
  type?: string;
  min_hz?: number;
  max_hz?: number;
  min_messages?: number;
  /** Largest allowed silence between two consecutive messages, in seconds. */
  max_gap_s?: number;
  /** A topic that need not exist; its other rules apply only when it does. */
  optional?: boolean;
}

export interface Expectations {
  min_duration_s?: number;
  max_duration_s?: number;
  /** Topics not listed in `topics` are fine unless this is false. Default true. */
  allow_extra_topics?: boolean;
  topics?: Record<string, TopicRule>;
}

const TOP_KEYS = ['min_duration_s', 'max_duration_s', 'allow_extra_topics', 'topics'];
const NUMERIC_RULES = ['min_hz', 'max_hz', 'min_messages', 'max_gap_s'] as const;
const RULE_KEYS = ['type', 'optional', ...NUMERIC_RULES];

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function number(v: unknown, where: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
    throw new UsageError(`${where} must be a non-negative number`);
  }
  return v;
}

export function parseExpectations(text: string): Expectations {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new UsageError(`expectations file is not valid JSON: ${(e as Error).message}`);
  }
  if (!isObject(raw)) throw new UsageError('expectations file must be a JSON object');
  for (const k of Object.keys(raw)) {
    if (!TOP_KEYS.includes(k)) throw new UsageError(`unknown key "${k}" (expected one of: ${TOP_KEYS.join(', ')})`);
  }
  const out: Expectations = {};
  if (raw.min_duration_s !== undefined) out.min_duration_s = number(raw.min_duration_s, 'min_duration_s');
  if (raw.max_duration_s !== undefined) out.max_duration_s = number(raw.max_duration_s, 'max_duration_s');
  if (raw.allow_extra_topics !== undefined) {
    if (typeof raw.allow_extra_topics !== 'boolean') throw new UsageError('allow_extra_topics must be true or false');
    out.allow_extra_topics = raw.allow_extra_topics;
  }
  if (raw.topics !== undefined) {
    if (!isObject(raw.topics)) throw new UsageError('topics must be an object keyed by topic name');
    out.topics = {};
    for (const [name, rule] of Object.entries(raw.topics)) {
      if (!isObject(rule)) throw new UsageError(`topics["${name}"] must be an object (use {} to only require the topic)`);
      for (const k of Object.keys(rule)) {
        if (!RULE_KEYS.includes(k)) {
          throw new UsageError(`topics["${name}"]: unknown key "${k}" (expected one of: ${RULE_KEYS.join(', ')})`);
        }
      }
      const r: TopicRule = {};
      if (rule.type !== undefined) {
        if (typeof rule.type !== 'string') throw new UsageError(`topics["${name}"].type must be a string`);
        r.type = rule.type;
      }
      if (rule.optional !== undefined) {
        if (typeof rule.optional !== 'boolean') throw new UsageError(`topics["${name}"].optional must be true or false`);
        r.optional = rule.optional;
      }
      for (const k of NUMERIC_RULES) {
        if (rule[k] !== undefined) r[k] = number(rule[k], `topics["${name}"].${k}`);
      }
      out.topics[name] = r;
    }
  }
  return out;
}

export interface Check {
  ok: boolean;
  /** `/scan` or `bag` for whole-recording rules. */
  subject: string;
  message: string;
}

export interface TopicRow {
  topic: string;
  type: string;
  count: number;
  hz: number;
  maxGapS: number;
}

/** Largest gap between consecutive messages. Sorted by the caller's stats, so a scan is enough. */
function maxGapSeconds(times: Float64Array): number {
  let max = 0;
  for (let i = 1; i < times.length; i++) max = Math.max(max, times[i]! - times[i - 1]!);
  return max / 1e9;
}

export function topicRows(summary: BagSummary, stats: AllTopicStats): TopicRow[] {
  return summary.topics.map((t) => {
    const s = stats[t.name];
    const h = s ? computeTopicHealth(t.name, s) : null;
    return {
      topic: t.name,
      type: t.type,
      count: t.messageCount,
      hz: h?.meanHz ?? 0,
      maxGapS: s ? maxGapSeconds(s.times) : 0,
    };
  });
}

const f = (n: number) => (n >= 100 ? n.toFixed(0) : n.toFixed(2).replace(/\.?0+$/, '') || '0');

export function evaluate(summary: BagSummary, stats: AllTopicStats, ex: Expectations): Check[] {
  const checks: Check[] = [];
  const add = (ok: boolean, subject: string, message: string) => checks.push({ ok, subject, message });

  if (ex.min_duration_s !== undefined) {
    add(summary.duration >= ex.min_duration_s, 'bag', `duration ${f(summary.duration)} s, need at least ${f(ex.min_duration_s)} s`);
  }
  if (ex.max_duration_s !== undefined) {
    add(summary.duration <= ex.max_duration_s, 'bag', `duration ${f(summary.duration)} s, need at most ${f(ex.max_duration_s)} s`);
  }

  const rows = new Map(topicRows(summary, stats).map((r) => [r.topic, r]));
  const rules = ex.topics ?? {};
  for (const [name, rule] of Object.entries(rules)) {
    const row = rows.get(name);
    if (!row) {
      if (!rule.optional) add(false, name, 'topic is missing');
      continue;
    }
    if (rule.type !== undefined) {
      add(normalizeType(row.type) === normalizeType(rule.type), name, `type ${row.type}, expected ${rule.type}`);
    }
    if (rule.min_messages !== undefined) {
      add(row.count >= rule.min_messages, name, `${row.count} messages, need at least ${rule.min_messages}`);
    }
    if (rule.min_hz !== undefined) add(row.hz >= rule.min_hz, name, `${f(row.hz)} Hz, need at least ${f(rule.min_hz)} Hz`);
    if (rule.max_hz !== undefined) add(row.hz <= rule.max_hz, name, `${f(row.hz)} Hz, need at most ${f(rule.max_hz)} Hz`);
    if (rule.max_gap_s !== undefined) {
      add(row.maxGapS <= rule.max_gap_s, name, `longest gap ${f(row.maxGapS)} s, allowed ${f(rule.max_gap_s)} s`);
    }
    if (Object.keys(rule).every((k) => k === 'optional')) add(true, name, 'present');
  }
  if (ex.allow_extra_topics === false) {
    for (const name of rows.keys()) if (!(name in rules)) add(false, name, 'unexpected topic');
  }
  return checks;
}

export interface RecordingReport {
  name: string;
  summary: BagSummary;
  rows: TopicRow[];
  checks: Check[];
}

export const passed = (r: RecordingReport) => r.checks.every((c) => c.ok);

export function formatText(reports: RecordingReport[]): string {
  const out: string[] = [];
  for (const r of reports) {
    out.push(`${passed(r) ? 'PASS' : 'FAIL'}  ${r.name}  (${f(r.summary.duration)} s, ${r.summary.totalMessageCount} messages, ${r.summary.topics.length} topics)`);
    const w = Math.max(5, ...r.rows.map((x) => x.topic.length));
    for (const x of r.rows) out.push(`  ${x.topic.padEnd(w)}  ${String(x.count).padStart(8)}  ${f(x.hz).padStart(8)} Hz  gap ${f(x.maxGapS)} s  ${x.type}`);
    for (const c of r.checks.filter((c) => !c.ok)) out.push(`  x ${c.subject}: ${c.message}`);
  }
  return `${out.join('\n')}\n`;
}

/** Markdown for `$GITHUB_STEP_SUMMARY`. */
export function formatMarkdown(reports: RecordingReport[]): string {
  const out: string[] = ['## Bag check', ''];
  for (const r of reports) {
    out.push(`### ${passed(r) ? 'PASS' : 'FAIL'}: \`${r.name}\``, '');
    out.push(`${f(r.summary.duration)} s, ${r.summary.totalMessageCount} messages, ${r.summary.topics.length} topics`, '');
    const failed = r.checks.filter((c) => !c.ok);
    if (failed.length > 0) {
      for (const c of failed) out.push(`- \`${c.subject}\`: ${c.message}`);
      out.push('');
    }
    out.push('| Topic | Type | Messages | Hz | Longest gap (s) |', '| --- | --- | ---: | ---: | ---: |');
    for (const x of r.rows) out.push(`| \`${x.topic}\` | \`${x.type}\` | ${x.count} | ${f(x.hz)} | ${f(x.maxGapS)} |`);
    out.push('');
  }
  return `${out.join('\n')}\n`;
}
