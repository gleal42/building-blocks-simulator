// Bundles src/ into one self-contained page: index.html (open it directly in a browser).
//   npm run build          build once
//   npm run dev            rebuild whenever a file in src/ changes
import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
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

// Two pages: index.html (the maker's app) and customer.html (what a buyer gets: only the
// packs they unlock, no maker tools).
async function buildOnce() {
  const started = Date.now();
  // The pattern search runs in a Web Worker made from this inlined source.
  const workerCode = await bundle('worker.js');
  const css = await readFile(src('styles.css'), 'utf8');
  const template = await readFile(src('index.html'), 'utf8');
  for (const [file, customer] of [['index.html', false], ['customer.html', true]]) {
    const appCode = await bundle('main.js', { __WORKER_SOURCE__: JSON.stringify(workerCode), __CUSTOMER_BUILD__: String(customer) });
    const html = template
      .replace('<!DOCTYPE html>', '<!DOCTYPE html>\n<!-- Built by "npm run build" from the files in src/. Edit those, not this file. -->')
      .replace('<title>Building Blocks Simulator</title>', customer ? '<title>Building Blocks</title>' : '<title>Building Blocks Simulator</title>')
      .replace('/*__CSS__*/', () => css)
      .replace('/*__JS__*/', () => appCode.replace(/<\/script/gi, '<\\/script'));
    await writeFile(path.join(root, file), html);
    console.log(`${file} written (${Math.round(html.length / 1024)} KB)`);
  }
  console.log(`built in ${Date.now() - started} ms`);
}

await buildOnce();

if (process.argv.includes('--watch')) {
  let timer = 0;
  console.log('Watching src/ for changes...');
  watch(path.join(root, 'src'), { recursive: true }, () => {
    clearTimeout(timer);
    timer = setTimeout(() => buildOnce().catch((err) => console.error(err.message)), 80);
  });
}
