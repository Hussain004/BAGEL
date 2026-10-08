/**
 * `bagel-check`: run the BAGEL parsers headlessly and gate a recording.
 *
 *   bagel-check [--expect rules.json] [--json] [--summary file.md] <bag|dir>...
 *
 * Exit codes: 0 every recording passed (or no rules were given), 1 a check
 * failed, 2 bad usage or an unreadable bag. Kept separate from `bin.ts` so the
 * tests can call `run` in-process.
 */

import { appendFileSync, openAsBlob, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parseBag, readAllMessageStats } from '../src/parsers/core';
import type { BagSource, SingleBagSource } from '../src/parsers/source';
import { groupBagFiles, type NamedFile } from '../src/utils/bagGroups';
import {
  UsageError,
  evaluate,
  formatMarkdown,
  formatText,
  parseExpectations,
  passed,
  topicRows,
  type Expectations,
  type RecordingReport,
} from './check';

interface PathFile extends NamedFile {
  path: string;
}

const USAGE = 'usage: bagel-check [--expect rules.json] [--json] [--summary file.md] <bag-or-folder>...';

interface Args {
  expect?: string;
  json: boolean;
  summary?: string;
  paths: string[];
}

function parseArgs(argv: string[]): Args {
  const args: Args = { json: false, paths: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const value = () => {
      const v = argv[++i];
      if (v === undefined) throw new UsageError(`${a} needs a value`);
      return v;
    };
    if (a === '--expect') args.expect = value();
    else if (a === '--summary') args.summary = value();
    else if (a === '--json') args.json = true;
    else if (a.startsWith('--')) throw new UsageError(`unknown option ${a}`);
    else args.paths.push(a);
  }
  if (args.paths.length === 0) throw new UsageError('no bag file or folder given');
  return args;
}

/** Files directly inside each folder, or the file itself. Not recursive: a folder is one rosbag2 directory. */
function collect(paths: string[]): PathFile[] {
  const out: PathFile[] = [];
  for (const p of paths) {
    let st;
    try {
      st = statSync(p);
    } catch {
      throw new UsageError(`cannot read ${p}`);
    }
    if (st.isDirectory()) {
      for (const name of readdirSync(p).sort()) {
        const path = join(p, name);
        if (statSync(path).isFile()) out.push({ name, dir: p, path });
      }
    } else out.push({ name: basename(p), dir: join(p, '..'), path: p });
  }
  return out;
}

async function toSource(files: PathFile[], displayName: string): Promise<BagSource> {
  const parts: SingleBagSource[] = [];
  for (const f of files) {
    // openAsBlob reads lazily, so a multi-gigabyte bag is never held in memory.
    parts.push({ kind: 'file', file: new File([await openAsBlob(f.path)], f.name) });
  }
  return parts.length === 1 ? parts[0]! : { kind: 'multi', parts, displayName };
}

export interface Io {
  out: (s: string) => void;
  err: (s: string) => void;
}

export async function run(argv: string[], io: Io): Promise<number> {
  try {
    const args = parseArgs(argv);
    let expectations: Expectations | null = null;
    if (args.expect) {
      let text: string;
      try {
        text = readFileSync(args.expect, 'utf8');
      } catch {
        throw new UsageError(`cannot read ${args.expect}`);
      }
      expectations = parseExpectations(text);
    }

    const files = collect(args.paths);
    const meta = files.find((f) => f.name === 'metadata.yaml');
    const groups = groupBagFiles(files, meta ? readFileSync(meta.path, 'utf8') : undefined);
    if (groups.length === 0) throw new UsageError('no .mcap, .db3 or .bag files found');

    const reports: RecordingReport[] = [];
    for (const g of groups) {
      const source = await toSource(g.files, g.displayName);
      let summary;
      try {
        summary = await parseBag(source);
      } catch (e) {
        throw new UsageError(`${g.displayName}: ${(e as Error).message}`);
      }
      const stats = await readAllMessageStats(source, summary.format);
      reports.push({
        name: g.displayName,
        summary,
        rows: topicRows(summary, stats),
        checks: expectations ? evaluate(summary, stats, expectations) : [],
      });
    }

    io.out(
      args.json
        ? `${JSON.stringify(reports.map((r) => ({ name: r.name, passed: passed(r), duration_s: r.summary.duration, topics: r.rows, checks: r.checks })), null, 2)}\n`
        : formatText(reports),
    );
    const md = formatMarkdown(reports);
    if (args.summary) writeFileSync(args.summary, md);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
    return reports.every(passed) ? 0 : 1;
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    io.err(`bagel-check: ${e.message}\n${USAGE}\n`);
    return 2;
  }
}
