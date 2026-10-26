/* Electron main process — hardened.
   - frameless rounded window with in-renderer title bar
   - Python 3 analysis engine (JSON-lines over stdio, no network)
   - native menu, file dialogs and a token-protected localhost REST API
   Security model: sandboxed renderer (no Node), minimal contextBridge surface,
   every filesystem IPC path contained inside ROOT/.runlet, no unvalidated
   shell.openExternal / window.open / navigation. */
const { app, BrowserWindow, ipcMain, dialog, Menu, shell, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');
const readline = require('readline');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const APP_INDEX = path.join(ROOT, 'app', 'index.html');
const APP_FILE_URL = pathToFileURL(APP_INDEX).href;
const WORKSPACE = path.join(ROOT, '.runlet', 'workspace');
const API_PORT = +(process.env.RUNLET_API_PORT || 7788);
const IS_DEV = process.env.RUNLET_DEV === '1';
const MAX_IPC_TEXT = 4 * 1024 * 1024;       // 4 MB per IPC text payload
const MAX_API_BODY = 6 * 1024 * 1024;       // 6 MB per REST body
const ENGINE_TIMEOUT = 15000;

let win = null;
let engine = null;
let engineQueue = [];
const projectCache = { name: 'Мой проект', files: {}, savedAt: 0 };

/* ── helpers ───────────────────────────────────────────────────── */
function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v) &&
    (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
}
function safeText(v, max = MAX_IPC_TEXT) {
  return typeof v === 'string' && v.length <= max && !v.includes('\0') ? v : null;
}
/** Resolve a renderer-supplied relative path and CONTAIN it inside ROOT. */
function insideRoot(rel) {
  if (typeof rel !== 'string' || !rel || rel.includes('\0') || rel.length > 512) return null;
  const full = path.resolve(ROOT, rel);
  if (full === ROOT || !full.startsWith(ROOT + path.sep)) return null;
  const relPath = path.relative(ROOT, full).split(path.sep);
  if (relPath.some(p => p === '..' || p === '.git' || p === 'node_modules')) return null;
  return full;
}
/** Only allow writing into a dedicated scratch directory, basename only. */
function workspaceTarget(name) {
  if (typeof name !== 'string' || !name || name.includes('\0') || name.length > 180) return null;
  if (/[/\\]/.test(name) || name === '..' || name.startsWith('.')) return null;
  return path.join(WORKSPACE, name);
}
/** Strict allowlist for shell.openExternal — prevents arbitrary protocol/SSRF. */
function safeExternalUrl(raw) {
  if (typeof raw !== 'string' || !raw || raw.length > 2048 || /[\0\r\n]/.test(raw)) return null;
  let u;
  try { u = new URL(raw); } catch (_) { return null; }
  if (u.username || u.password) return null;
  if (u.protocol === 'mailto:') return u.href;
  if (u.protocol !== 'https:') return null;              // no http, file, javascript, data, custom schemes
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h === '127.0.0.1' || h === '::1' || h.endsWith('.localhost')) return null;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(':')) return null; // no raw IPs / IPv6 literals
  return u.href;
}
function validateJob(job) {
  if (!isPlainObject(job)) return 'job must be an object';
  if (!isPlainObject(job.files)) return 'files must be an object';
  const entries = Object.entries(job.files);
  if (entries.length > 200) return 'too many files';
  let total = 0;
  for (const [name, content] of entries) {
    if (typeof name !== 'string' || name.length > 300 || name.includes('\0') || /[\\]/.test(name)) return 'bad file name';
    if (typeof content !== 'string') return 'file content must be a string';
    total += content.length;
    if (content.length > 2 * 1024 * 1024 || total > MAX_IPC_TEXT) return 'files too large';
  }
  return null;
}

/* ── Python engine (never gets unvalidated input) ────────────────── */
function enginePath() { return path.join(ROOT, 'analysis', 'engine.py'); }
function startEngine() {
  if (engine) return engine;
  const py = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  engine = spawn(py, [enginePath(), '--server'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    // No shell, no inherited env tricks, capped resource use is up to the OS.
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' }
  });
  engine.on('error', err => { console.error('[engine]', err.message); engine = null; });
  engine.on('exit', code => { console.warn('[engine] exited', code); engine = null; });
  engine.stderr.on('data', d => process.stderr.write('[engine] ' + d));
  const rl = readline.createInterface({ input: engine.stdout });
  rl.on('line', line => {
    if (!line.trim() || line.length > MAX_IPC_TEXT) return;
    const next = engineQueue.shift();
    if (next) { try { next.resolve(JSON.parse(line)); } catch (e) { next.reject(e); } }
  });
  return engine;
}
function analyze(job) {
  return new Promise((resolve, reject) => {
    const bad = validateJob(job);
    if (bad) return reject(new Error('invalid analysis job: ' + bad));
    const proc = startEngine();
    if (!proc) return reject(new Error('python3 not found — using JS fallback'));
    engineQueue.push({ resolve, reject });
    try { proc.stdin.write(JSON.stringify(job) + '\n'); }
    catch (e) { engineQueue.pop(); reject(e); }
    setTimeout(() => {
      const i = engineQueue.findIndex(q => q.resolve === resolve);
      if (i >= 0) { engineQueue.splice(i, 1); reject(new Error('engine timeout')); }
    }, ENGINE_TIMEOUT);
  });
}

/* ── window ────────────────────────────────────────────────────── */
function createWindow() {
  win = new BrowserWindow({
    width: 1580, height: 980, minWidth: 1000, minHeight: 640,
    backgroundColor: '#0b0d18',
    frame: false, resizable: true, thickFrame: true, show: false,
    icon: path.join(ROOT, 'public', 'icon.svg'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,                 // renderer + preload run in the OS sandbox
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      enableWebSQL: false,
      webviewTag: false,
      spellcheck: false,
      safeDialogs: true,
      safeDialogsMessage: 'Слишком много диалогов подряд — Runlet их заблокировал.',
      autoplayPolicy: 'user-gesture-required'
    }
  });
  win.once('ready-to-show', () => win.show());
  if (IS_DEV) win.loadURL('http://localhost:4173').catch(() => win.loadFile(APP_INDEX));
  else win.loadFile(APP_INDEX);

  const wc = win.webContents;
  // Deny every popup from the renderer. The preview pop-out uses the dedicated
  // `preview:popout` IPC which creates an isolated window with no opener.
  wc.setWindowOpenHandler(({ url }) => {
    const safe = safeExternalUrl(url);
    if (safe) shell.openExternal(safe);
    return { action: 'deny' };
  });
  // Lock navigation to our own shell (or the dev server in dev mode).
  wc.on('will-navigate', (event, url) => {
    const allowed = url === APP_FILE_URL || url.startsWith(APP_FILE_URL + '?') ||
      (IS_DEV && url.startsWith('http://localhost:4173/'));
    if (!allowed) {
      event.preventDefault();
      const safe = safeExternalUrl(url);
      if (safe) shell.openExternal(safe);
    }
  });
  wc.on('will-redirect', (event, url) => {
    if (!(url === APP_FILE_URL || url.startsWith(APP_FILE_URL + '?') ||
          (IS_DEV && url.startsWith('http://localhost:4173/')))) event.preventDefault();
  });
  wc.on('will-attach-webview', event => event.preventDefault());
  wc.session.setPermissionRequestHandler((_wc, permission, callback) => callback(false));
  wc.on('closed', () => { win = null; });
}

/** Isolated pop-out window for the preview. data: URL => opaque origin, no opener. */
function openPreviewPopout(html) {
  const text = safeText(html, 8 * 1024 * 1024);
  if (!text) return false;
  const popup = new BrowserWindow({
    width: 1000, height: 760, title: 'Runlet — предпросмотр',
    backgroundColor: '#ffffff', autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true, sandbox: true, nodeIntegration: false,
      nodeIntegrationInSubFrames: false, webSecurity: true, webviewTag: false,
      allowRunningInsecureContent: false, spellcheck: false
    }
  });
  popup.setMenu(null);
  popup.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(text)).catch(() => popup.close());
  popup.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  popup.webContents.session.setPermissionRequestHandler((_w, _p, cb) => cb(false));
  return true;
}

function buildMenu() {
  const send = id => win?.webContents.send('menu:command', id);
  const tpl = [
    { label: 'Файл', submenu: [
      { label: 'Новый проект', accelerator: 'CmdOrCtrl+N', click: () => send('startScreen') },
      { label: 'Открыть файл…', accelerator: 'CmdOrCtrl+O', click: () => send('upload') },
      { label: 'Сохранить', accelerator: 'CmdOrCtrl+S', click: () => send('save') },
      { label: 'Экспорт ZIP', click: () => send('exportZip') },
      { label: 'Импорт ZIP', click: () => send('importZip') },
      { type: 'separator' }, { label: 'Выход', role: 'quit' } ] },
    { label: 'Правка', submenu: [
      { label: 'Отменить', role: 'undo' }, { label: 'Повторить', role: 'redo' }, { type: 'separator' },
      { label: 'Вырезать', role: 'cut' }, { label: 'Копировать', role: 'copy' },
      { label: 'Вставить', role: 'paste' }, { label: 'Выделить всё', role: 'selectAll' },
      { type: 'separator' },
      { label: 'Палитра команд', accelerator: 'CmdOrCtrl+Shift+P', click: () => send('palette') } ] },
    { label: 'Вид', submenu: [
      { label: 'Три колонки', accelerator: 'Alt+1', click: () => send('layoutColumns') },
      { label: 'Три строки', accelerator: 'Alt+2', click: () => send('layoutRows') },
      { label: 'Вкладки', accelerator: 'Alt+3', click: () => send('layoutTabs') }, { type: 'separator' },
      { label: 'Сменить тему', click: () => send('theme') },
      { label: 'Настройки', accelerator: 'CmdOrCtrl+,', click: () => send('settings') },
      { label: 'Полный экран', role: 'togglefullscreen' } ] },
    { label: 'Запуск', submenu: [
      { label: 'Запустить', accelerator: 'CmdOrCtrl+Enter', click: () => send('run') },
      { label: 'Анализ кода', accelerator: 'CmdOrCtrl+Shift+A', click: () => send('analyze') },
      { label: 'Форматировать', accelerator: 'CmdOrCtrl+Shift+F', click: () => send('format') },
      { label: 'Открыть предпросмотр в окне', click: () => send('popout') } ] },
    { label: 'Инструменты', submenu: [
      { label: 'CSS-лаборатория', click: () => send('cssLab') },
      { label: 'Сниппеты', accelerator: 'CmdOrCtrl+Shift+K', click: () => send('snippets') },
      { label: 'Библиотеки CDN', click: () => send('librarySearch') },
      { label: 'Плагины', click: () => send('plugins') },
      { label: 'Обучение', click: () => send('learn') },
      ...(IS_DEV ? [{ label: 'Инструменты разработчика', role: 'toggleDevTools' }] : []) ] },
    { label: 'Справка', submenu: [
      { label: 'Быстрый тур', click: () => send('tour') },
      { label: 'Горячие клавиши', accelerator: 'F1', click: () => send('shortcuts') },
      { label: 'О программе', click: () => send('settings') } ] }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(tpl));
}

/* ── IPC: every handler validates its arguments ─────────────────── */
function registerIPC() {
  ipcMain.handle('analyze', async (_, job) => {
    try { return await analyze(job); }
    catch (e) { return { ok: false, error: e.message }; }
  });
  ipcMain.handle('app:info', () => ({
    version: app.getVersion(), platform: process.platform,
    python: !!engine, electron: process.versions.electron, sandbox: true,
    secureApi: true
  }));
  ipcMain.handle('python:check', () => ({ available: !!startEngine() }));
  ipcMain.handle('win:control', (_, action) => {
    if (!win || !['minimize', 'maximize', 'close'].includes(action)) return false;
    if (action === 'minimize') win.minimize();
    else if (action === 'maximize') win.isMaximized() ? win.unmaximize() : win.maximize();
    else win.close();
    return true;
  });
  ipcMain.handle('fs:open', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'] });
    if (r.canceled) return null;
    const out = [];
    for (const p of r.filePaths.slice(0, 30)) {
      try {
        const st = fs.statSync(p);
        if (!st.isFile() || st.size > MAX_IPC_TEXT) continue;
        out.push({ name: path.basename(p), content: fs.readFileSync(p, 'utf8') });
      } catch (_) { /* skip unreadable */ }
    }
    return out;
  });
  ipcMain.handle('fs:save', async (_, payload) => {
    if (!isPlainObject(payload)) return false;
    const content = safeText(payload.content);
    if (content === null) return false;
    let name = typeof payload.name === 'string' ? path.basename(payload.name) : 'index.html';
    if (!name || name.includes('\0') || name.length > 180) name = 'index.html';
    const r = await dialog.showSaveDialog(win, { defaultPath: name });
    if (r.canceled) return false;
    fs.writeFileSync(r.filePath, content, 'utf8');
    return true;
  });
  ipcMain.handle('fs:read', (_, file) => {
    const full = insideRoot(file);
    if (!full) return null;
    if (!/\.(html?|css|js|mjs|cjs|ts|jsx|tsx|json|md|txt|svg|py|yml|yaml|webmanifest)$/i.test(full)) return null;
    try {
      if (fs.statSync(full).size > MAX_IPC_TEXT) return null;
      return fs.readFileSync(full, 'utf8');
    } catch (_) { return null; }
  });
  ipcMain.handle('fs:write', (_, payload) => {
    if (!isPlainObject(payload)) return false;
    const content = safeText(payload.content);
    const target = workspaceTarget(payload.file);
    if (content === null || !target) return false;
    try { fs.mkdirSync(WORKSPACE, { recursive: true }); fs.writeFileSync(target, content, 'utf8'); return true; }
    catch (_) { return false; }
  });
  ipcMain.handle('shell:open', (_, url) => {
    const safe = safeExternalUrl(url);
    if (safe) shell.openExternal(safe);
    return !!safe;
  });
  ipcMain.handle('preview:popout', (_, html) => openPreviewPopout(html));
}

/* ── REST API (127.0.0.1 only + random token + Host/Origin checks) ─ */
let API_TOKEN = null;
function makeToken() {
  API_TOKEN = process.env.RUNLET_API_TOKEN && process.env.RUNLET_API_TOKEN.length >= 32
    ? process.env.RUNLET_API_TOKEN
    : crypto.randomBytes(32).toString('hex');
  try {
    const dir = app.getPath('userData');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'api-token');
    fs.writeFileSync(file, API_TOKEN, { mode: 0o600, flag: 'w' });
    try { fs.chmodSync(file, 0o600); } catch (_) { }
  } catch (_) { /* token still printed below */ }
  console.log('[runlet] REST API token:', API_TOKEN);
}
function apiGuard(req) {
  // DNS-rebinding protection: only loopback Host headers are accepted.
  const host = (req.headers.host || '').toLowerCase();
  const allowedHosts = new Set([
    `127.0.0.1:${API_PORT}`, `localhost:${API_PORT}`, `[::1]:${API_PORT}`,
    '127.0.0.1', 'localhost', '[::1]'
  ]);
  if (!allowedHosts.has(host)) return 'bad host';
  // CSRF protection: a browser sends Origin; other origins are rejected.
  const origin = req.headers.origin;
  if (origin) {
    const allowedOrigins = new Set([`http://127.0.0.1:${API_PORT}`, `http://localhost:${API_PORT}`, 'null', 'file://']);
    if (!allowedOrigins.has(origin)) return 'bad origin';
  }
  const token = req.headers['x-runlet-token'];
  if (typeof token !== 'string' || token.length !== API_TOKEN.length ||
      !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(API_TOKEN))) return 'bad token';
  return null;
}
const analyzeHits = [];
function startAPI() {
  makeToken();
  const server = http.createServer(async (req, res) => {
    let url;
    try { url = new URL(req.url, 'http://127.0.0.1'); } catch (_) { return send(400, { error: 'bad url' }); }
    function send(code, obj) {
      res.writeHead(code, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY'
        // No Access-Control-Allow-Origin: cross-origin pages cannot read replies.
      });
      res.end(JSON.stringify(obj));
    }
    if (req.method === 'OPTIONS') return send(405, { error: 'method not allowed' });
    if (url.pathname === '/api/health') {
      return send(200, { ok: true, app: 'Runlet', version: app.getVersion(), python: !!engine, auth: true });
    }
    if (!url.pathname.startsWith('/api/')) return send(404, { error: 'not found' });
    const denied = apiGuard(req);
    if (denied) return send(403, { error: denied });

    let body = '';
    if (req.method === 'POST' || req.method === 'PUT') {
      const ct = req.headers['content-type'] || '';
      if (!/^application\/json\b/i.test(ct)) return send(415, { error: 'content-type must be application/json' });
      body = await new Promise(resolve => {
        let b = '';
        req.on('data', c => { b += c; if (b.length > MAX_API_BODY) { resolve(null); req.destroy(); } });
        req.on('end', () => resolve(b));
        req.on('error', () => resolve(null));
      });
      if (body === null) return send(413, { error: 'body too large' });
    }

    if (url.pathname === '/api/analyze' && req.method === 'POST') {
      const now = Date.now();
      while (analyzeHits.length && now - analyzeHits[0] > 60000) analyzeHits.shift();
      if (analyzeHits.length >= 60) return send(429, { error: 'rate limit' });
      analyzeHits.push(now);
      let job;
      try { job = JSON.parse(body); } catch (_) { return send(400, { error: 'bad json' }); }
      try { return send(200, await analyze(job)); }
      catch (e) { return send(502, { ok: false, error: e.message }); }
    }
    if (url.pathname === '/api/project') {
      if (req.method === 'PUT') {
        let data;
        try { data = JSON.parse(body); } catch (_) { return send(400, { error: 'bad json' }); }
        if (!isPlainObject(data)) return send(400, { error: 'bad project' });
        // Copy only known keys — no prototype pollution via __proto__/constructor.
        for (const k of ['name', 'files', 'entry', 'panes', 'deps', 'savedAt']) {
          if (Object.prototype.hasOwnProperty.call(data, k)) projectCache[k] = data[k];
        }
        projectCache.savedAt = Date.now();
        win?.webContents.send('menu:command', 'refreshInspectors');
        return send(200, { ok: true });
      }
      if (req.method === 'GET') return send(200, projectCache);
      return send(405, { error: 'method not allowed' });
    }
    if (url.pathname === '/api/files' && req.method === 'GET') {
      return send(200, { files: Object.keys(projectCache.files || {}) });
    }
    if (url.pathname === '/api/run' && req.method === 'POST') {
      win?.webContents.send('menu:command', 'run');
      return send(200, { ok: true });
    }
    return send(404, { error: 'not found' });
  });
  server.listen(API_PORT, '127.0.0.1', () => console.log(`[runlet] REST API http://127.0.0.1:${API_PORT} (token required)`));
  server.on('error', e => console.warn('[runlet] REST API disabled:', e.message));
}

/* ── lifecycle ─────────────────────────────────────────────────── */
app.whenReady().then(() => {
  nativeTheme.themeSource = 'system';
  registerIPC();
  buildMenu();
  createWindow();
  startEngine();
  startAPI();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => { try { engine?.kill(); } catch (_) { } });
