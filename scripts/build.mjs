/* esbuild bundle for the renderer. No runtime build tools needed by the user. */
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const watch = process.argv.includes('--watch');
const minify = process.argv.includes('--minify');

const opts = {
  entryPoints: [path.join(root, 'app/src/main.js')],
  outfile: path.join(root, 'app/dist/bundle.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2020', 'chrome100', 'firefox100', 'safari15'],
  sourcemap: false,
  minify,
  legalComments: 'none',
  logLevel: 'info',
  define: { 'process.env.NODE_ENV': '"production"' },
  loader: { '.woff2': 'dataurl', '.svg': 'text' }
};

function copyStatic() {
  fs.mkdirSync(path.join(root, 'app/dist'), { recursive: true });
  fs.copyFileSync(path.join(root, 'app/src/styles.css'), path.join(root, 'app/dist/styles.css'));
}

async function main() {
  copyStatic();
  if (watch) {
    const c = await esbuild.context(opts);
    await c.watch();
    fs.watchFile(path.join(root, 'app/src/styles.css'), { interval: 400 }, copyStatic);
    console.log('[runlet] watching app/src …');
  } else {
    const result = await esbuild.build({ ...opts, metafile: true });
    const out = result.metafile.outputs[Object.keys(result.metafile.outputs)[0]];
    console.log(`[runlet] bundle.js: ${(out.bytes / 1024).toFixed(0)} КБ`);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
