/* Static dev server + Python analysis bridge + tiny REST API.
   The browser preview (Arena live preview) uses this server, so the Python
   engine works even without Electron. Hardened: no wildcard CORS, random
   per-process API token, Host/Origin validation, body/rate limits, static
   allowlist and security headers. */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = +(process.env.PORT || 4173);
const HOST = process.env.HOST || '0.0.0.0';
const STORE = path.join(root, '.runlet');
const MAX_BODY = 4 * 1024 * 1024;
const MAX_LINE = 8 * 1024 * 1024;
const ENGINE_TIMEOUT = 15000;
fs.mkdirSync(STORE, { recursive: true });

const TOKEN = process.env.RUNLET_API_TOKEN && process.env.RUNLET_API_TOKEN.length >= 32
  ? process.env.RUNLET_API_TOKEN
  : crypto.randomBytes(32).toString('hex');
console.log('[runlet] API token:', TOKEN);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json',
  '.md': 'text/markdown; charset=utf-8', '.ico': 'image/x-icon', '.map': 'application/json'
};

// Preview iframes are srcdoc (about:srcdoc) and run user code inline, so
// 'unsafe-inline'/'unsafe-eval' are required there; everything else is locked.
const CSP = [
  "default-src 'self' data: blob: https:",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: https: http://localhost:* http://127.0.0.1:*",
  "style-src 'self' 'unsafe-inline' https:",
  "img-src 'self' data: blob: https: file:",
  "font-src 'self' data: https:",
  "connect-src 'self' https: http://localhost:* http://127.0.0.1:* ws: wss:",
  "frame-src 'self' data: blob: about:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self' https:"
].join('; ');

/* ── persistent Python engine (JSON-lines protocol) ───────────── */
let engine = null, engineQueue = [], engineReady = false;
function startEngine() {
  if (engine) return;
  const py = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  engine = spawn(py, [path.join(root, 'analysis/engine.py'), '--server'], {
    stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' }
  });
  engine.on('error', () => { engine = null; });
  engine.on('exit', () => { engine = null; engineReady = false; });
  engine.stderr.on('data', d => process.stderr.write('[engine] ' + d));
  const rl = readline.createInterface({ input: engine.stdout });
  rl.on('line', line => {
    if (!line.trim() || line.length > MAX_LINE) return;
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
    }, ENGINE_TIMEOUT);
  });
}
function validJob(job) {
  if (!job || typeof job !== 'object' || Array.isArray(job) || !job.files || typeof job.files !== 'object' || Array.isArray(job.files)) return false;
  const entries = Object.entries(job.files);
  if (entries.length > 200) return false;
  let total = 0;
  for (const [name, content] of entries) {
    if (typeof name !== 'string' || name.length > 300 || name.includes('\0') || name.includes('\\')) return false;
    if (typeof content !== 'string' || content.length > 2 * 1024 * 1024) return false;
    total += content.length;
    if (total > MAX_BODY) return false;
  }
  return true;
}

const HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-origin',
  // Deliberately NO Access-Control-Allow-Origin: other sites cannot read replies.
};
function send(res, code, body, type = 'application/json; charset=utf-8', extra = {}) {
  res.writeHead(code, { 'Content-Type': type, ...HEADERS, ...extra });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
function readBody(req) {
  return new Promise(resolve => {
    let b = '', dead = false;
    req.on('data', c => {
      if (dead) return;
      b += c;
      if (b.length > MAX_BODY) { dead = true; resolve(null); req.destroy(); }
    });
    req.on('end', () => { if (!dead) resolve(b); });
    req.on('error', () => { if (!dead) { dead = true; resolve(null); } });
  });
}
/** Only app/dist, public and the shell are served. No source, no .git, no .runlet. */
function safePath(urlPath) {
  let p;
  try { p = decodeURIComponent(urlPath.split('?')[0]); } catch (_) { return null; }
  if (!p || p.includes('\0')) return null;
  p = p.replace(/^\/+/, '');
  if (!p) p = 'app/index.html';
  if (p === 'sw.js') p = 'public/sw.js';
  const map = { 'dist/': 'app/dist/', 'public/': 'public/', 'app/dist/': 'app/dist/' };
  for (const [k, v] of Object.entries(map)) if (p.startsWith(k)) { p = v + p.slice(k.length); break; }
  const full = path.resolve(root, p);
  if (!full.startsWith(root + path.sep)) return null;
  const rel = path.relative(root, full).split(path.sep);
  if (rel.includes('..') || rel.includes('.git') || rel.includes('.runlet') || rel.includes('node_modules')) return null;
  const allowedDir = rel[0] === 'public' || (rel[0] === 'app' && (rel[1] === 'dist' || rel[1] === 'index.html'));
  if (!allowedDir) return null;
  if (!MIME[path.extname(full).toLowerCase()]) return null;
  try { if (!fs.statSync(full).isFile()) return null; } catch (_) { return null; }
  return full;
}
function apiGuard(req) {
  // CSRF: a browser sends Origin; require it to match the Host we were reached at.
  const host = (req.headers.host || '').toLowerCase();
  const origin = req.headers.origin;
  if (origin) {
    let o;
    try { o = new URL(origin); } catch (_) { return 'bad origin'; }
    if (o.host.toLowerCase() !== host) return 'origin/host mismatch';
  }
  const token = req.headers['x-runlet-token'];
  if (typeof token !== 'string' || token.length !== TOKEN.length) return 'bad token';
  try {
    if (!crypto.timingSafeEqual(Buffer.from(token), Buffer.from(TOKEN))) return 'bad token';
  } catch (_) { return 'bad token'; }
  return null;
}
const analyzeHits = [];

const server = http.createServer(async (req, res) => {
  let url;
  try { url = new URL(req.url, 'http://localhost'); } catch (_) { return send(res, 400, { error: 'bad url' }); }
  const p = url.pathname;
  if (req.method === 'OPTIONS') return send(res, 405, { error: 'method not allowed' });
  if (p === '/api/health') return send(res, 200, { ok: true, engine: !!engine, version: '1.0', auth: true });

  if (p.startsWith('/api/')) {
    const denied = apiGuard(req);
    if (denied) return send(res, 403, { error: denied });
    let body = '';
    if (req.method === 'POST' || req.method === 'PUT') {
      if (!/^application\/json\b/i.test(req.headers['content-type'] || ''))
        return send(res, 415, { error: 'content-type must be application/json' });
      body = await readBody(req);
      if (body === null) return send(res, 413, { error: 'body too large' });
    }
    if (p === '/api/analyze' && req.method === 'POST') {
      const now = Date.now();
      while (analyzeHits.length && now - analyzeHits[0] > 60000) analyzeHits.shift();
      if (analyzeHits.length >= 90) return send(res, 429, { error: 'rate limit' });
      analyzeHits.push(now);
      let job;
      try { job = JSON.parse(body); } catch (_) { return send(res, 400, { error: 'bad json' }); }
      if (!validJob(job)) return send(res, 400, { error: 'invalid analysis job' });
      try { return send(res, 200, await analyze(job)); }
      catch (e) { return send(res, 502, { ok: false, error: e.message }); }
    }
    if (p === '/api/project') {
      const file = path.join(STORE, 'project.json');
      if (req.method === 'GET') {
        try { return send(res, 200, fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { files: {} }); }
        catch (_) { return send(res, 200, { files: {} }); }
      }
      if (req.method === 'PUT') {
        let data;
        try { data = JSON.parse(body); } catch (_) { return send(res, 400, { error: 'bad json' }); }
        if (!data || typeof data !== 'object' || Array.isArray(data)) return send(res, 400, { error: 'bad project' });
        fs.writeFileSync(file, JSON.stringify(data));
        return send(res, 200, { ok: true });
      }
    }
    if (p === '/api/files' && req.method === 'GET') return send(res, 200, { files: fs.readdirSync(STORE) });
    if (p === '/api/run' && req.method === 'POST') return send(res, 200, { ok: true });
    return send(res, 404, { error: 'unknown endpoint' });
  }

  let file = safePath(p);
  if (!file || !fs.existsSync(file)) {
    if (p === '/' || p === '/index.html') file = path.join(root, 'app/index.html');
    else return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
  }
  const ext = path.extname(file).toLowerCase();
  let payload = fs.readFileSync(file);
  const extra = {};
  if (ext === '.html') {
    // Same-origin page learns the token; a foreign origin cannot read the HTML.
    payload = Buffer.from(payload.toString('utf8').replace(/__RUNLET_TOKEN__/g, TOKEN));
    extra['Content-Security-Policy'] = CSP;
  }
  send(res, 200, payload, MIME[ext] || 'application/octet-stream', extra);
});

server.listen(PORT, HOST, () => {
  console.log(`[runlet] http://localhost:${PORT}  (${HOST} — preview ready)`);
  startEngine();
});
process.on('SIGINT', () => { engine?.kill(); process.exit(0); });
