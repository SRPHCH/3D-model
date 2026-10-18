// Bundles src/main.js (with three.js, tree-shaken + minified) and inlines it into one
// self-contained index.html — no CDN, works from any static server or straight from disk.
import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';

const result = await build({
  entryPoints: ['src/main.js'],
  bundle: true,
  minify: true,
  format: 'esm',
  target: ['es2020'],
  legalComments: 'none',
  write: false,
});

const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const html = (await readFile('src/template.html', 'utf8')).replace('/*__BUNDLE__*/', () => js);
await writeFile('index.html', html);
console.log(`index.html written (${(html.length / 1024).toFixed(0)} KB)`);
