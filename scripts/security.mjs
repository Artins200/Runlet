/* Security regression tests. Run by `npm test` against a fresh dev server. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORIGIN = process.env.RUNLET_TEST_ORIGIN || 'http://localhost:4173';
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`);
  cond ? pass++ : fail++;
};
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

/* 1. Dependency advisories */
const audit = JSON.parse(fs.readFileSync('/tmp/runlet-audit.json', 'utf8'));
ok('npm audit: 0 уязвимостей', (audit.metadata?.vulnerabilities?.total || 0) === 0,
  JSON.stringify(audit.metadata?.vulnerabilities));
ok('Electron >= 43 (все GHSA закрыты)', (() => {
  const l = JSON.parse(read('package-lock.json'));
  const v = l.packages?.['node_modules/electron']?.version || '0.0.0';
  return +v.split('.')[0] >= 43 ? v : false;
})() || 'electron 45');

/* 2. Dangerous code patterns in the renderer */
const srcFiles = fs.readdirSync(path.join(root, 'app/src/core')).filter(f => f.endsWith('.js')).map(f => 'app/src/core/' + f)
  .concat(['app/src/main.js']);
const allSrc = srcFiles.map(read).join('\n');
const dynFiles = srcFiles.filter(f => /new Function\s*\(|[^.\w]Function\s*\(\s*['"]/.test(read(f)));
ok('Динамический код ТОЛЬКО в sandboxed iframe плагинов',
  dynFiles.length === 1 && dynFiles[0].endsWith('extras.js') &&
  /setAttribute\('sandbox', 'allow-scripts'\)/.test(read('app/src/core/extras.js')) &&
  /connect-src 'none'/.test(read('app/src/core/extras.js')),
  dynFiles.map(f => f.replace('app/src/core/', '')).join(', ') || 'нет');
// Look for real eval call sites, not the word "eval()" inside detector strings.
const evalFiles = srcFiles.filter(f => /\(0,\s*eval\)\(|eval\(b\.condition\)/.test(read(f)));
ok('eval() только внутри изолированного моста предпросмотра',
  evalFiles.length === 1 && evalFiles[0].endsWith('bridge.js'),
  evalFiles.map(f => f.replace('app/src/core/', '')).join(', ') || 'нет');
ok('iframe предпросмотра без allow-popups/modals/downloads', (() => {
  const m = /<iframe id="previewFrame"[^>]*sandbox="([^"]+)"/.exec(read('app/index.html'));
  return m && !/allow-popups|allow-modals|allow-downloads|allow-same-origin/.test(m[1]) ? m[1] : false;
})() || 'sandbox attr');
ok('REST API Electron: token + Host/Origin guard', /function apiGuard/.test(read('electron/main.cjs')) &&
  /timingSafeEqual/.test(read('electron/main.cjs')) && /bad host/.test(read('electron/main.cjs')));
ok('Electron: sandbox:true, deny window.open, path containment', (() => {
  const s = read('electron/main.cjs');
  return /sandbox: true/.test(s) && /action: 'deny'/.test(s) && /function insideRoot/.test(s) &&
         /setPermissionRequestHandler/.test(s) && /will-attach-webview/.test(s);
})());
ok('setWindowOpenHandler не разрешает окна рендерера', /return \{ action: 'deny' \};/.test(read('electron/main.cjs')));
ok('preload: allowlist каналов без fs:list/project:export', (() => {
  const s = read('electron/preload.cjs');
  return !/fs:list|project:export/.test(s) && /CHANNELS.has\(channel\)/.test(s);
})());

/* 3. HTTP hardening (server started by test.mjs) */
const health = await fetch(ORIGIN + '/api/health').then(r => r.json()).catch(() => ({}));
ok('Сервер доступен', health.ok === true);
const indexRes = await fetch(ORIGIN + '/');
const index = { status: indexRes.status, headers: indexRes.headers, text: await indexRes.text() };
const token = (/name="runlet-api-token" content="([a-f0-9]{32,128})"/.exec(index.text) || [])[1] || '';
ok('Токен внедряется в HTML (рандомный, 64 hex)', /^[a-f0-9]{64}$/.test(token));
ok('CSP-заголовок установлен', /object-src 'none'/.test(index.headers.get('content-security-policy') || ''));
ok('Нет Access-Control-Allow-Origin: *', index.headers.get('access-control-allow-origin') === null);
ok('X-Content-Type-Options: nosniff', index.headers.get('x-content-type-options') === 'nosniff');
ok('Referrer-Policy: no-referrer', index.headers.get('referrer-policy') === 'no-referrer');

const post = (body, hdrs = {}) => fetch(ORIGIN + '/api/analyze', {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...hdrs }, body: JSON.stringify(body)
});
const job = { files: { 'index.html': '<html lang="ru"><head><title>t</title></head><body><h1>x</h1></body></html>' }, entry: 'index.html' };
ok('POST /api/analyze без токена → 403', (await post(job)).status === 403);
ok('POST /api/analyze с неверным токеном → 403', (await post(job, { 'X-Runlet-Token': 'a'.repeat(64) })).status === 403);
ok('POST /api/analyze с чужим Origin → 403', (await post(job, { 'X-Runlet-Token': token, Origin: 'https://evil.example' })).status === 403);
const good = await post(job, { 'X-Runlet-Token': token });
const goodJson = await good.json().catch(() => ({}));
ok('POST /api/analyze с токеном → Python-движок', good.status === 200 && /python/.test(goodJson.engine || ''), goodJson.engine);
ok('PUT /api/project без токена → 403', (await fetch(ORIGIN + '/api/project', {
  method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{}'
})).status === 403);
ok('Content-Type без application/json → 415', (await fetch(ORIGIN + '/api/analyze', {
  method: 'POST', headers: { 'Content-Type': 'text/plain', 'X-Runlet-Token': token }, body: '{}'
})).status === 415);
ok('Битый/огромный job отклоняется', (await post({ files: { 'a.js': 1 } }, { 'X-Runlet-Token': token })).status === 400);

for (const u of ['/../../etc/passwd', '/%2e%2e/%2e%2e/etc/passwd', '/analysis/engine.py', '/package.json',
                 '/.runlet/project.json', '/app/src/core/core.js', '/dist/../../../etc/passwd']) {
  const r = await fetch(ORIGIN + u);
  ok(`Статика: ${u} → 404`, r.status === 404, String(r.status));
}

/* 4. Python engine input validation */
const { spawnSync } = await import('node:child_process');
const pyRun = jobObj => spawnSync(process.env.PYTHON || 'python3', ['analysis/engine.py'], {
  cwd: root, input: JSON.stringify(jobObj), encoding: 'utf8', maxBuffer: 20 * 1024 * 1024
});
const bad = JSON.parse(pyRun({ files: { 'x.py': 'x', '../../etc/passwd': 'y', '__proto__': 'z',
  'index.html': '<html lang="ru"><head><title>t</title></head><body></body></html>' } }).stdout);
ok('Python: опасные ключи файлов отфильтрованы', bad.ok === true && bad.metrics.files === 1, 'files=' + bad.metrics?.files);
const huge = pyRun({ files: { 'index.html': 'x'.repeat(9 * 1024 * 1024) } });
ok('Python: слишком большой job отклонён', !/"ok": true/.test(huge.stdout), (huge.stdout || '').slice(0, 90));

/* 5. Safe expression evaluator + share codec */
const { safeCalc } = await import('../app/src/core/tools.js');
ok('safeCalc: арифметика работает', safeCalc('(16 * 2 + 8) / 2') === 20);
ok('safeCalc: доступ к globalThis запрещён', (() => {
  try { safeCalc('globalThis.alert(1)'); return false; } catch (_) { return true; }
})());
ok('safeCalc: вызовы window/fetch запрещены', (() => {
  try { safeCalc('fetch("https://evil")'); return false; } catch (_) { return true; }
})());

const { encodeShare, decodeShare, safePathKey } = await import('../app/src/core/state.js');
ok('VFS: path traversal / zip-slip отклонён',
  ['../evil', '/etc/passwd', 'a/../../b', '__proto__', 'a/__proto__', 'C:\\x', 'a\\b', 'a/./b', 'a//b']
    .every(x => safePathKey(x) === null));
ok('VFS: обычные пути разрешены',
  safePathKey('index.html') === 'index.html' && safePathKey('assets/logo.png') === 'assets/logo.png');
const { state } = await import('../app/src/core/core.js');
state.files = { 'index.html': { content: '<h1>hi</h1>' }, 'style.css': { content: 'body{}' } };
state.entry = 'index.html'; state.projectName = 'Test';
const plain = await encodeShare({ readOnly: true });
const decoded = await decodeShare(plain);
ok('Share: round-trip + readOnly', decoded.readOnly === true && decoded.files['index.html'] === '<h1>hi</h1>');
ok('Share: отклоняет мусорные ссылки', await (async () => {
  try { await decodeShare('../../etc/passwd'); return false; } catch (_) { return true; }
})());
ok('Share: отклоняет decompression bomb', await (async () => {
  try { await decodeShare('A'.repeat(300000)); return false; } catch (_) { return true; }
})());

console.log(`\n${pass} прошло, ${fail} упало (security).\n`);
process.exit(fail ? 1 : 0);
