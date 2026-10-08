// Bundle the headless bagel-check CLI into one committed file so the GitHub
// Action can run it with no install step. CI rebuilds it and fails on drift.
import { build } from 'esbuild';
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';

const out = 'cli/bundle';
mkdirSync(out, { recursive: true });

// db3.ts points sql.js at the browser URL '/sql-wasm.wasm'. In Node that must be
// the file next to the bundle, so rewrite it while bundling (and fail loudly if
// the source line ever changes, rather than shipping a CLI that cannot open db3).
const BROWSER_WASM = "locateFile: () => '/sql-wasm.wasm'";
const nodeWasm = {
  name: 'node-sql-wasm',
  setup(b) {
    b.onLoad({ filter: /parsers[\\/]db3\.ts$/ }, (args) => {
      const src = readFileSync(args.path, 'utf8');
      if (!src.includes(BROWSER_WASM)) throw new Error('db3.ts no longer contains the sql.js locateFile line; update scripts/build-cli.mjs');
      return { contents: src.replace(BROWSER_WASM, "locateFile: (f: string) => __dirname + '/' + f"), loader: 'ts' };
    });
  },
};

await build({
  plugins: [nodeWasm],
  entryPoints: ['cli/bin.ts'],
  outfile: `${out}/bagel-check.mjs`,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  // Bundled CJS dependencies (sql.js) expect require, __filename and __dirname.
  banner: { js: "import{createRequire as __cr}from'module';const require=__cr(import.meta.url);import{fileURLToPath as __fu}from'url';import{dirname as __dn}from'path';const __filename=__fu(import.meta.url);const __dirname=__dn(__filename);" },
  legalComments: 'none',
});
// sql.js (for .db3) looks for its wasm next to the running script.
copyFileSync('node_modules/sql.js/dist/sql-wasm.wasm', `${out}/sql-wasm.wasm`);
