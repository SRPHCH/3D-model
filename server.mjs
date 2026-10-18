// Minimal static server for hosting (Render / Railway / any VPS). No dependencies.
// Serves the prebuilt index.html (gzip-compressed once at start-up) plus docs/ assets.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { extname, join, normalize } from 'node:path';

const PORT = Number(process.env.PORT) || 8080;
const ROOT = new URL('.', import.meta.url).pathname;
const TYPES = { '.html': 'text/html; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png', '.mp4': 'video/mp4', '.webp': 'image/webp' };
const ALLOWED = new Set(['/index.html', '/docs/preview.jpg', '/docs/demo.mp4']);

const cache = new Map(); // path -> { body, gz, type }
async function load(path) {
  if (cache.has(path)) return cache.get(path);
  const body = await readFile(join(ROOT, normalize(path)));
  const type = TYPES[extname(path)] || 'application/octet-stream';
  const entry = { body, gz: type.startsWith('text/') ? gzipSync(body, { level: 9 }) : null, type };
  cache.set(path, entry);
  return entry;
}

createServer(async (req, res) => {
  let path = new URL(req.url, 'http://x').pathname;
  if (path === '/' || path === '') path = '/index.html';
  if (path === '/healthz') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('ok'); }
  if (!ALLOWED.has(path)) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('not found'); }
  try {
    const f = await load(path);
    const useGz = f.gz && /\bgzip\b/.test(req.headers['accept-encoding'] || '');
    res.writeHead(200, {
      'content-type': f.type,
      'cache-control': f.type.startsWith('text/html') ? 'public, max-age=300' : 'public, max-age=86400',
      ...(useGz ? { 'content-encoding': 'gzip', vary: 'accept-encoding' } : {}),
    });
    res.end(req.method === 'HEAD' ? undefined : useGz ? f.gz : f.body);
  } catch {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('error');
  }
}).listen(PORT, () => console.log(`Little Explorer on :${PORT}`));
