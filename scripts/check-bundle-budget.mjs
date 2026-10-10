// Fails when a built chunk's gzipped size passes its budget. Run after `vite build`.
// Budgets sit about 12-20% above today's sizes: they catch an accidental dependency
// or a lost code split, not ordinary growth. Raise one deliberately in the PR that needs it.
import { readdirSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const KB = 1024;
const budgets = [
  { prefix: 'index-', max: 200 * KB, what: 'main entry' },
  { prefix: 'three-', max: 190 * KB, what: 'three.js' },
  { prefix: 'parser.worker-', max: 160 * KB, what: 'parser worker' },
];

const dir = 'dist/assets';
const files = readdirSync(dir).filter((f) => f.endsWith('.js'));
let failed = false;
for (const { prefix, max, what } of budgets) {
  const file = files.find((f) => f.startsWith(prefix));
  if (!file) {
    console.error(`budget: no chunk starting with "${prefix}" in ${dir} (${what})`);
    failed = true;
    continue;
  }
  const size = gzipSync(readFileSync(`${dir}/${file}`), { level: 9 }).length;
  const ok = size <= max;
  console.log(`${ok ? 'ok  ' : 'OVER'} ${what.padEnd(12)} ${(size / KB).toFixed(1)} KB gzip of ${(max / KB).toFixed(0)} KB (${file})`);
  if (!ok) failed = true;
}
process.exit(failed ? 1 : 0);
