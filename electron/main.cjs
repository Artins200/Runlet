/* Electron main process.
   - frameless rounded window with in-renderer title bar
   - Python 3 analysis engine (JSON-lines over stdio, no network)
   - native menu, file dialogs and a localhost REST API for the CLI */
const { app, BrowserWindow, ipcMain, dialog, Menu, shell, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');
const readline = require('readline');

const ROOT = path.resolve(__dirname, '..');
const API_PORT = +(process.env.RUNLET_API_PORT || 7788);
let win = null;
let engine = null;
let engineQueue = [];
const projectCache = { name: 'Мой проект', files: {}, savedAt: 0 };

/* ── Python engine ─────────────────────────────────────────────── */
function enginePath() {
  return path.join(ROOT, 'analysis', 'engine.py');
}
function startEngine() {
  if (engine) return engine;
  const py = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  engine = spawn(py, [enginePath(), '--server'], { stdio: ['pipe', 'pipe', 'pipe'] });
  engine.on('error', err => { console.error('[engine]', err.message); engine = null; });
  engine.on('exit', code => { console.warn('[engine] exited', code); engine = null; });
  engine.stderr.on('data', d => process.stderr.write('[engine] ' + d));
  const rl = readline.createInterface({ input: engine.stdout });
  rl.on('line', line => {
    if (!line.trim()) return;
    const next = engineQueue.shift();
    if (next) { try { next.resolve(JSON.parse(line)); } catch (e) { next.reject(e); } }
  });
  return engine;
}
function analyze(job) {
  return new Promise((resolve, reject) => {
    const proc = startEngine();
    if (!proc) return reject(new Error('python3 not found — using JS fallback'));
    engineQueue.push({ resolve, reject });
    try { proc.stdin.write(JSON.stringify(job) + '\n'); }
    catch (e) { engineQueue.pop(); reject(e); }
    setTimeout(() => {
      const i = engineQueue.findIndex(q => q.resolve === resolve);
      if (i >= 0) { engineQueue.splice(i, 1); reject(new Error('engine timeout')); }
    }, 15000);
  });
}

/* ── window ────────────────────────────────────────────────────── */
function createWindow() {
  win = new BrowserWindow({
    width: 1580, height: 980, minWidth: 1000, minHeight: 640,
    backgroundColor: '#0b0d18',
    frame: false,
    resizable: true,
    thickFrame: true,
    show: false,
    icon: path.join(ROOT, 'public', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: false
    }
  });
  win.once('ready-to-show', () => win.show());
  const dev = process.env.RUNLET_DEV === '1';
  if (dev) win.loadURL('http://localhost:4173').catch(() => win.loadFile(path.join(ROOT, 'app/index.html')));
  else win.loadFile(path.join(ROOT, 'app/index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) { shell.openExternal(url); return { action: 'deny' }; }
    return { action: 'allow' };
  });
  win.on('closed', () => { win = null; });
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
      { label: 'Инструменты разработчика', role: 'toggleDevTools' } ] },
    { label: 'Справка', submenu: [
      { label: 'Быстрый тур', click: () => send('tour') },
      { label: 'Горячие клавиши', accelerator: 'F1', click: () => send('shortcuts') },
      { label: 'О программе', click: () => send('settings') } ] }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(tpl));
}

/* ── IPC ───────────────────────────────────────────────────────── */
function registerIPC() {
  ipcMain.handle('analyze', async (_, job) => {
    try { return await analyze(job); }
    catch (e) { return { ok: false, error: e.message }; }
  });
  ipcMain.handle('app:info', () => ({ version: app.getVersion(), platform: process.platform,
    python: !!engine, electron: process.versions.electron, cwd: ROOT }));
  ipcMain.handle('python:check', async () => ({ available: !!startEngine(), path: enginePath() }));
  ipcMain.handle('win:control', (_, action) => {
    if (!win) return;
    if (action === 'minimize') win.minimize();
    else if (action === 'maximize') win.isMaximized() ? win.unmaximize() : win.maximize();
    else if (action === 'close') win.close();
  });
  ipcMain.handle('fs:open', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'] });
    if (r.canceled) return null;
    return r.filePaths.map(p => ({ name: path.basename(p), content: fs.readFileSync(p, 'utf8') }));
  });
  ipcMain.handle('fs:save', async (_, { name, content }) => {
    const r = await dialog.showSaveDialog(win, { defaultPath: name || 'index.html' });
    if (r.canceled) return false;
    fs.writeFileSync(r.filePath, content, 'utf8'); return true;
  });
  ipcMain.handle('fs:read', (_, file) => {
    try { return fs.readFileSync(path.isAbsolute(file) ? file : path.join(ROOT, file), 'utf8'); }
    catch (e) { return null; }
  });
  ipcMain.handle('fs:write', (_, { file, content }) => {
    fs.writeFileSync(path.join(ROOT, file), content, 'utf8'); return true;
  });
  ipcMain.handle('shell:open', (_, url) => { if (/^https?:/.test(url)) shell.openExternal(url); });
}

/* ── REST API (localhost only, for the CLI / automation) ───────── */
function startAPI() {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const send = (code, obj) => {
      res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS' });
      res.end(JSON.stringify(obj));
    };
    if (req.method === 'OPTIONS') return send(204, {});
    let body = '';
    req.on('data', c => body += c);
    await new Promise(r => req.on('end', r));
    if (url.pathname === '/api/health') return send(200, { ok: true, app: 'Runlet', version: app.getVersion(), python: !!engine });
    if (url.pathname === '/api/analyze' && req.method === 'POST') {
      try { return send(200, await analyze(JSON.parse(body))); } catch (e) { return send(502, { ok: false, error: e.message }); }
    }
    if (url.pathname === '/api/project') {
      if (req.method === 'PUT') { Object.assign(projectCache, JSON.parse(body), { savedAt: Date.now() }); win?.webContents.send('menu:command', 'refreshInspectors'); return send(200, { ok: true }); }
      return send(200, projectCache);
    }
    if (url.pathname === '/api/run') { win?.webContents.send('menu:command', 'run'); return send(200, { ok: true }); }
    if (url.pathname === '/api/report') return send(200, { note: 'Use /api/analyze', report: null });
    return send(404, { error: 'not found' });
  });
  server.listen(API_PORT, '127.0.0.1', () => console.log(`[runlet] REST API http://127.0.0.1:${API_PORT}`));
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
app.on('before-quit', () => { try { engine?.kill(); } catch (e) { } });
