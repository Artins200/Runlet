/* Static dev server + Python analysis bridge + tiny REST API.
   The browser preview (Arena live preview) uses this server, so the Python
   engine works even without Electron. */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = +(process.env.PORT || 4173);
const HOST = process.env.HOST || '0.0.0.0';
const STORE = path.join(root, '.runlet');
fs.mkdirSync(STORE, { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json',
  '.md': 'text/markdown; charset=utf-8', '.py': 'text/x-python; charset=utf-8',
  '.ico': 'image/x-icon', '.map': 'application/json'
};

/* ── persistent Python engine (JSON-lines protocol) ───────────── */
let engine = null, engineQueue = [], engineReady = false;
function startEngine() {
  if (engine) return;
  const py = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  engine = spawn(py, [path.join(root, 'analysis/engine.py'), '--server'], { stdio: ['pipe', 'pipe', 'pipe'] });
  engine.on('error', () => { engine = null; });
  engine.on('exit', () => { engine = null; engineReady = false; });
  engine.stderr.on('data', d => process.stderr.write('[engine] ' + d));
  const rl = readline.createInterface({ input: engine.stdout });
  rl.on('line', line => {
    if (!line.trim()) return;
    const next = engineQueue.shift();
    if (next) { try { next.resolve(JSON.parse(line)); } catch (e) { next.reject(e); } }
  });
  engineReady = true;
}
function analyze(job) {
  return new Promise((resolve, reject) => {
    startEngine();
    if (!engine || !engineReady) return reject(new Error('python engine unavailable'));
    engineQueue.push({ resolve, reject });
    try { engine.stdin.write(JSON.stringify(job) + '\n'); }
    catch (e) { engineQueue.pop(); reject(e); }
    setTimeout(() => {
      const i = engineQueue.findIndex(x => x.resolve === resolve);
      if (i >= 0) { engineQueue.splice(i, 1); reject(new Error('engine timeout')); }
    }, 15000);
  });
}

function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*',
                        'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
function readBody(req) {
  return new Promise(resolve => {
    let b = ''; req.on('data', c => { b += c; if (b.length > 20_000_000) req.destroy(); });
    req.on('end', () => resolve(b));
  });
}
function safePath(urlPath) {
  let p = decodeURIComponent(urlPath.split('?')[0]).replace(/^\/+/, '');
  if (!p) p = 'app/index.html';
  if (p === 'sw.js') p = 'public/sw.js';
  const map = { 'dist/': 'app/dist/', 'public/': 'public/', 'analysis/': 'analysis/', 'app/': 'app/' };
  for (const [k, v] of Object.entries(map)) if (p.startsWith(k)) { p = v + p.slice(k.length); break; }
  if (!/^(app|public|analysis)\//.test(p)) p = 'app/' + p;
  const full = path.resolve(root, p);
  if (!full.startsWith(root)) return null;
  return full;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  if (req.method === 'OPTIONS') return send(res, 204, '');
  if (p === '/api/health') return send(res, 200, { ok: true, engine: !!engine, version: '1.0', pid: process.pid });
  if (p === '/api/analyze' && req.method === 'POST') {
    try {
      const job = JSON.parse(await readBody(req));
      const report = await analyze(job);
      return send(res, 200, report);
    } catch (e) { return send(res, 502, { ok: false, error: e.message }); }
  }
  if (p === '/api/project') {
    const file = path.join(STORE, 'project.json');
    if (req.method === 'GET') return send(res, 200, fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { files: {} });
    if (req.method === 'PUT') { fs.writeFileSync(file, await readBody(req)); return send(res, 200, { ok: true }); }
  }
  if (p === '/api/files') return send(res, 200, { files: fs.readdirSync(STORE) });
  if (p === '/api/run') return send(res, 200, { ok: true, message: 'Run the project in the editor UI' });
  if (p.startsWith('/api/')) return send(res, 404, { error: 'unknown endpoint' });

  let file = safePath(p);
  if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    if (p === '/' || p === '/index.html') file = path.join(root, 'app/index.html');
    else return send(res, 404, 'Not found: ' + p, 'text/plain; charset=utf-8');
  }
  const ext = path.extname(file).toLowerCase();
  send(res, 200, fs.readFileSync(file), MIME[ext] || 'application/octet-stream');
});

server.listen(PORT, HOST, () => {
  console.log(`[runlet] http://localhost:${PORT}  (0.0.0.0 — Arena preview ready)`);
  startEngine();
});
process.on('SIGINT', () => { engine?.kill(); process.exit(0); });
