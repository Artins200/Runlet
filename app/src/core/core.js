/* Runlet shared core: state, tiny event bus, DOM helpers, settings, i18n. */

export const DEFAULT_SETTINGS = {
  theme: 'auto', accent: '#7c6cf6', density: 'comfy',
  fontSize: 13, fontFamily: 'mono', lineHeight: 1.6, tabSize: 2,
  showWhitespace: false, showInvisibles: true, wrap: false,
  cursorStyle: 'smooth', smoothScroll: true, stickyHeaders: true,
  minimap: true, breadcrumbs: true, autoRun: true, autoRunDelay: 650,
  autoAnalyze: true, autoAnalyzeDelay: 1600, autoSave: true, autoSaveInterval: 20,
  formatOnPaste: true, trimTrailingWhitespace: true,
  presets: 'balanced', locale: 'ru', firstRun: true,
  pythonEngine: true, hotCss: true, hotJs: true, codeToPreview: true,
  timeLimit: 4000, confirmDelete: true,
  keybindings: {
    'run': 'Ctrl+Enter', 'format': 'Ctrl+Shift+F', 'save': 'Ctrl+S',
    'download': 'Ctrl+Shift+S', 'palette': 'Ctrl+Shift+P', 'analyze': 'Ctrl+Shift+A',
    'assistant': 'Ctrl+Shift+I', 'snippets': 'Ctrl+Shift+K', 'shortcuts': 'F1',
    'newFile': 'Ctrl+Alt+N', 'findInProject': 'Ctrl+Shift+J',
    'toggleComment': 'Ctrl+/', 'duplicateLine': 'Ctrl+Shift+D',
    'moveLineUp': 'Alt+ArrowUp', 'moveLineDown': 'Alt+ArrowDown',
    'multiCursor': 'Ctrl+D', 'layoutColumns': 'Alt+1', 'layoutRows': 'Alt+2',
    'layoutTabs': 'Alt+3', 'previewFullscreen': 'Alt+Enter'
  }
};

export const DEFAULT_FILES = {
  'index.html': `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="description" content="Моя страница на Runlet">
  <title>Привет, Runlet!</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <main class="card">
    <span class="badge">Runlet studio</span>
    <h1>Привет, Runlet! 👋</h1>
    <p>Пиши код слева — результат появится справа. А вкладка «Анализ» расскажет, что делает код и где ошибки.</p>
    <div class="row">
      <button id="btn">Нажми меня</button>
      <button class="ghost" id="reset">Сбросить</button>
    </div>
    <div id="output" class="output"> here will be the result </div>
  </main>
  <script src="script.js"></script>
</body>
</html>`,
  'style.css': `@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&display=swap');

:root {
  --accent: #7c6cf6;
  --bg: #10132a;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  min-height: 100vh;
  display: grid;
  place-items: center;
  font-family: Inter, system-ui, sans-serif;
  background: radial-gradient(circle at 20% 10%, #2a2160, transparent 55%), var(--bg);
  color: #eef0ff;
}
.card {
  width: min(560px, 90vw);
  padding: 36px;
  border-radius: 28px;
  background: rgba(255, 255, 255, .07);
  border: 1px solid rgba(255, 255, 255, .13);
  box-shadow: 0 24px 70px rgba(0, 0, 0, .35);
  backdrop-filter: blur(14px);
}
.badge {
  display: inline-block;
  padding: 5px 12px;
  border-radius: 99px;
  font-size: 12px;
  font-weight: 600;
  background: var(--accent);
}
h1 { margin: 18px 0 8px; font-size: 34px; letter-spacing: -1px; }
p { color: #b9bddc; line-height: 1.65; }
.row { display: flex; gap: 10px; margin: 22px 0 14px; flex-wrap: wrap; }
button {
  border: 0;
  border-radius: 13px;
  padding: 12px 20px;
  font-weight: 700;
  color: #fff;
  background: linear-gradient(135deg, var(--accent), #b06cf6);
  cursor: pointer;
  transition: transform .2s, box-shadow .2s;
}
button:hover { transform: translateY(-2px); box-shadow: 0 8px 22px #7c6cf655; }
button.ghost { background: rgba(255,255,255,.1); }
.output {
  min-height: 46px;
  padding: 12px 16px;
  border-radius: 14px;
  background: rgba(0,0,0,.22);
  font-family: ui-monospace, monospace;
  font-size: 14px;
  color: #9ef5c9;
}
`,
  'script.js': `const btn = document.querySelector('#btn');
const reset = document.querySelector('#reset');
const output = document.querySelector('#output');
let clicks = 0;

btn.addEventListener('click', () => {
  clicks += 1;
  output.textContent = 'Кликов: ' + clicks;
  console.log('Пользователь нажал кнопку', clicks);
});

reset.addEventListener('click', () => {
  clicks = 0;
  output.textContent = 'Счётчик сброшен';
});

// Попробуйте добавить сюда fetch, setTimeout или localStorage —
// Python-движок увидит это в отчёте и объяснит поведение.
`
};

export const state = {
  files: {},              // path -> { content, kind, mime, size, updated }
  entry: 'index.html',
  panes: { html: 'index.html', css: 'style.css', js: 'script.js' },
  activePane: 'html',
  activeFile: 'index.html',
  layout: 'columns',
  collapsed: { html: false, css: false, js: false },
  projectName: 'Мой проект',
  settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
  deps: [],
  dirty: false,
  logs: [],
  activity: [],
  snapshots: [],
  report: null,
  engine: 'unknown',
  breakpoints: {},
  watch: [],
  trace: [],
  traceIndex: -1,
  network: [],
  storageData: {},
  domTree: null,
  computedStyles: {},
  perf: {},
  consoleFilter: 'all',
  consoleSearch: '',
  consoleGroup: true,
  inspectMode: false,
  jsEnabled: true,
  externalEnabled: true,
  alertsAsToast: true,
  autoRun: true,
  device: 'desktop',
  deviceSize: { w: 1000, h: 600 },
  zoom: 'fit',
  userSnippets: [],
  plugins: [],
  progress: {},
  collabPeers: {},
  analytics: { views: 0, embeds: 0 }
};

export const ctx = {};   // runtime API, wired in main.js
const listeners = new Map();

/* ── command registry (shared by buttons, hotkeys and the palette) ── */
export const commands = new Map();
export function registerCommand(id, def) { commands.set(id, { id, ...def }); }
export function runCommand(id, arg) {
  const c = commands.get(id);
  if (!c) { console.warn('[runlet] unknown command', id); return undefined; }
  try { const r = c.run(arg); if (r && typeof r.catch === 'function') r.catch(e => toast('Ошибка команды: ' + e.message, 'err')); return r; }
  catch (e) { toast(`${id}: ${e.message}`, 'err'); console.error(e); }
}

export function on(evt, fn) {
  if (!listeners.has(evt)) listeners.set(evt, new Set());
  listeners.get(evt).add(fn);
  return () => off(evt, fn);
}
export function off(evt, fn) { listeners.get(evt)?.delete(fn); }
export function emit(evt, data) {
  for (const fn of [...(listeners.get(evt) || [])]) {
    try { fn(data); } catch (e) { console.error('[runlet] listener', evt, e); }
  }
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(n.style, v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    n.appendChild(typeof kid === 'string' || typeof kid === 'number' ? document.createTextNode(String(kid)) : kid);
  }
  return n;
}
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
export function uid(prefix = 'id') { return prefix + '-' + Math.random().toString(36).slice(2, 9); }
export function debounce(fn, ms = 200) {
  let t; const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.cancel = () => clearTimeout(t); d.flush = (...a) => { clearTimeout(t); fn(...a); };
  return d;
}
export function throttle(fn, ms = 100) {
  let last = 0;
  return (...a) => { const now = Date.now(); if (now - last >= ms) { last = now; fn(...a); } };
}
export function fmtBytes(n) {
  if (n < 1024) return n + ' Б';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' КБ';
  return (n / 1048576).toFixed(2) + ' МБ';
}
export function download(name, content, mime = 'text/plain') {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime + ';charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}
export async function copy(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch (_) {
    const ta = document.createElement('textarea'); ta.value = text;
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (e) { /* ignore */ }
    ta.remove(); return true;
  }
}
export function toast(msg, type = 'info', title = '') {
  const icons = { ok: '✓', err: '✕', warn: '⚠', info: 'ℹ' };
  const box = $('#toasts'); if (!box) return;
  const node = el('div', { class: 'toast ' + type },
    el('span', { class: 't-icon', text: icons[type] || '•' }),
    el('div', {}, title ? el('b', { text: title }) : null, el('span', { text: msg })));
  box.appendChild(node);
  setTimeout(() => { node.style.opacity = '0'; node.style.transform = 'translateX(30px)'; node.style.transition = '.25s'; }, 3800);
  setTimeout(() => node.remove(), 4200);
  logAction(msg, type);
}
export function logAction(msg, kind = 'info') {
  state.activity.unshift({ t: Date.now(), msg, kind });
  if (state.activity.length > 300) state.activity.length = 300;
  emit('activity', state.activity);
}
export function markDirty(v = true) {
  state.dirty = v;
  $('#dirtyDot')?.classList.toggle('on', v);
  $('.pane-dirty')?.classList.toggle('on', v);
}
export function busy(v) {
  $('#readyIndicator')?.classList.toggle('busy', v);
  const label = $('#readyIndicator');
  if (label) label.innerHTML = '<i></i>' + (v ? 'анализ…' : 'готов');
}

/* ── i18n (RU / EN) ───────────────────────────────────────────────── */
const I18N = {
  en: {
    'Run': 'Run', 'Analyze': 'Analyze', 'Files': 'Files', 'Search': 'Search',
    'Libraries': 'Libraries', 'Assets': 'Assets', 'Plugins': 'Plugins',
    'Lessons': 'Lessons', 'Ideas': 'Ideas', 'Analysis': 'Analysis',
    'Console': 'Console', 'Debug': 'Debug', 'Network': 'Network',
    'Storage': 'Storage', 'Perf': 'Perf', 'Assistant': 'Assistant', 'Log': 'Log',
    'Preview': 'Preview', 'Settings': 'Settings', 'Tour': 'Tour'
  }
};
export function t(key) {
  const loc = state.settings.locale;
  return (loc === 'en' && I18N.en[key]) || key;
}
export function applyLocale() {
  const en = state.settings.locale === 'en';
  const map = [
    ['[data-cmd="run"] span', 'Run'], ['.btn-analyze span', 'Analyze'],
    ['[data-rail-tab="files"]', 'Files'], ['[data-rail-tab="search"]', 'Search'],
    ['[data-rail-tab="libs"]', 'Libraries'], ['[data-rail-tab="assets"]', 'Assets'],
    ['[data-rail-tab="plugins"]', 'Plugins'], ['[data-rail-tab="learn"]', 'Lessons'],
    ['[data-rail-tab="features"]', 'Ideas'], ['[data-insp-tab="analysis"]', 'Analysis'],
    ['[data-insp-tab="console"]', 'Console'], ['[data-insp-tab="debug"]', 'Debug'],
    ['[data-insp-tab="network"]', 'Network'], ['[data-insp-tab="storage"]', 'Storage'],
    ['[data-insp-tab="perf"]', 'Perf'], ['[data-insp-tab="assistant"]', 'Assistant'],
    ['[data-insp-tab="log"]', 'Log'], ['[data-cmd="settings"]', 'Settings'],
    ['[data-cmd="tour"] span', 'Tour']
  ];
  for (const [sel, enText] of map) {
    const node = $(sel);
    if (!node) continue;
    if (!node.dataset.ru) node.dataset.ru = node.textContent.trim();
    node.textContent = en ? enText : node.dataset.ru;
  }
  document.documentElement.lang = state.settings.locale === 'ar' ? 'ar' : state.settings.locale;
}

/* ── theme / appearance ────────────────────────────────────────────── */
export function applyTheme() {
  const s = state.settings;
  let theme = s.theme;
  if (theme === 'auto') theme = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.density = s.density;
  document.documentElement.style.setProperty('--accent', s.accent);
  document.documentElement.style.setProperty('--accent2', shiftHue(s.accent, 42));
  document.documentElement.style.setProperty('--cm-fs', s.fontSize + 'px');
  document.documentElement.style.setProperty('--cm-lh', String(s.lineHeight));
  const mono = {
    mono: '"JetBrains Mono", "Fira Code", "SF Mono", Consolas, monospace',
    system: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    courier: '"Courier New", Courier, monospace',
    sans: 'var(--sans)'
  }[s.fontFamily] || 'monospace';
  document.documentElement.style.setProperty('--mono', mono);
  const c = $('#accentInput'); if (c) c.value = s.accent;
  emit('theme', theme);
}
function shiftHue(hex, deg) {
  try {
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
    let h = 0, s = 0;
    if (max !== min) {
      const d = max - min;
      s = l > .5 ? d / (2 - max - min) : d / (max + min);
      h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h *= 60;
    }
    h = (h + deg) % 360;
    const c2 = (1 - Math.abs(2 * l - 1)) * s, x = c2 * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c2 / 2;
    let rr = 0, gg = 0, bb = 0;
    if (h < 60) [rr, gg, bb] = [c2, x, 0]; else if (h < 120) [rr, gg, bb] = [x, c2, 0];
    else if (h < 180) [rr, gg, bb] = [0, c2, x]; else if (h < 240) [rr, gg, bb] = [0, x, c2];
    else if (h < 300) [rr, gg, bb] = [x, 0, c2]; else [rr, gg, bb] = [c2, 0, x];
    return '#' + [rr, gg, bb].map(v => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('');
  } catch (e) { return '#b06cf6'; }
}

/* ── key helpers ────────────────────────────────────────────────────── */
export function keyEventToString(e) {
  const parts = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  let k = e.key;
  if (k === ' ') k = 'Space';
  else if (k.length === 1) k = k.toUpperCase();
  else k = { ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown', Escape: 'Esc', '`': '`' }[k] || k;
  parts.push(k);
  return parts.join('+');
}
export function parseKey(combo) {
  const p = (combo || '').split('+').map(x => x.trim());
  const key = p.pop() || '';
  return {
    ctrl: p.includes('Ctrl') || p.includes('Meta'), alt: p.includes('Alt'),
    shift: p.includes('Shift'), key: key.length === 1 ? key.toLowerCase() : key
  };
}
export function matchKey(e, combo) {
  const k = parseKey(combo);
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const want = k.key === 'Esc' ? 'Escape' : k.key;
  return !!(e.ctrlKey || e.metaKey) === k.ctrl && e.altKey === k.alt && e.shiftKey === k.shift &&
    (key === want || key.toLowerCase() === String(want).toLowerCase());
}
