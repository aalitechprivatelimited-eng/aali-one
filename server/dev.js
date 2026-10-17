// Local / VPS server: serves the built app from dist/ and the API on one port.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handle } from './app.js';

const DIST = fileURLToPath(new URL('../dist/', import.meta.url));
const TYPES = { '.woff2': 'font/woff2', '.woff': 'font/woff', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon' };
const port = +process.env.PORT || +process.argv[2] || 3000;
// The same page headers as vercel.json: no framing by other sites, no guessing of file types, scripts only from Aali One itself.
const HEADERS = Object.fromEntries(JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8')).headers[0].headers.map((h) => [h.key, h.value]));

createServer(async (req, res) => {
  if (req.url.startsWith('/api/')) return handle(req, res);
  let clean = '/'; try { clean = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^([.][.][/\\])+/, ''); } catch { /* a badly formed address gets the app's first page */ }
  let file = join(DIST, clean);
  try { if (!file.startsWith(DIST) || clean === '/' || !extname(file)) file = join(DIST, 'index.html');
    const body = await readFile(file); res.writeHead(200, { ...HEADERS, 'content-type': TYPES[extname(file)] || 'application/octet-stream' }); res.end(body); }
  catch { const body = await readFile(join(DIST, 'index.html')).catch(() => 'Run npm run build first.'); res.writeHead(200, { ...HEADERS, 'content-type': 'text/html; charset=utf-8' }); res.end(body); }
}).listen(port, () => console.log(`Aali One on http://localhost:${port}`));
