// Bundles src/ into one self-contained page: index.html (open it directly in a browser).
// The packs that ship with the app are the files in packs/ (one pack per .json file).
//   npm run build          build once
//   npm run dev            rebuild whenever a file in src/ or packs/ changes
import { build } from 'esbuild';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { watch } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (file) => path.join(root, 'src', file);

async function bundle(entry, define = {}) {
  const result = await build({
    entryPoints: [src(entry)],
    bundle: true,
    format: 'iife',
    target: ['es2020'],
    write: false,
    legalComments: 'inline',
    charset: 'utf8',
    define,
  });
  return result.outputFiles[0].text;
}

/** The packs in packs/, sorted by file name. */
async function readPackFiles() {
  const dir = path.join(root, 'packs');
  const names = (await readdir(dir).catch(() => [])).filter((f) => f.endsWith('.json')).sort();
  const packs = [];
  for (const name of names) {
    try {
      packs.push(JSON.parse(await readFile(path.join(dir, name), 'utf8')));
    } catch (err) {
      throw new Error(`packs/${name}: ${err.message}`);
    }
  }
  return packs;
}

async function buildOnce() {
  const started = Date.now();
  // The pattern search runs in a Web Worker made from this inlined source.
  const workerCode = await bundle('worker.js');
  const packs = await readPackFiles();
  const appCode = await bundle('main.js', { __WORKER_SOURCE__: JSON.stringify(workerCode), __BUILT_IN_PACKS__: JSON.stringify(packs) });
  const css = await readFile(src('styles.css'), 'utf8');
  const template = await readFile(src('index.html'), 'utf8');
  const html = template
    .replace('<!DOCTYPE html>', '<!DOCTYPE html>\n<!-- Built by "npm run build" from the files in src/ and packs/. Edit those, not this file. -->')
    .replace('/*__CSS__*/', () => css)
    .replace('/*__JS__*/', () => appCode.replace(/<\/script/gi, '<\\/script'));
  await writeFile(path.join(root, 'index.html'), html);
  console.log(`index.html written (${Math.round(html.length / 1024)} KB, ${packs.length} built-in pack${packs.length === 1 ? '' : 's'}) in ${Date.now() - started} ms`);
}

await buildOnce();

if (process.argv.includes('--watch')) {
  let timer = 0;
  console.log('Watching src/ and packs/ for changes...');
  const again = () => {
    clearTimeout(timer);
    timer = setTimeout(() => buildOnce().catch((err) => console.error(err.message)), 80);
  };
  watch(path.join(root, 'src'), { recursive: true }, again);
  watch(path.join(root, 'packs'), again);
}
