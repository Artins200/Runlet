/* Virtual file system, persistence (localStorage + IndexedDB), snapshots, settings. */
import { state, ctx, DEFAULT_SETTINGS, DEFAULT_FILES, $, on, emit, debounce, toast, fmtBytes, markDirty, applyTheme, applyLocale } from './core.js';
import { deflateSync, inflateSync, strToU8, strFromU8 } from 'fflate';

const LS_KEY = 'runlet:session:v2';
const LS_SETTINGS = 'runlet:settings:v2';
let db = null;

export async function initStorage() {
  try {
    const req = indexedDB.open('runlet-db', 1);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
    };
    req.onsuccess = () => { db = req.result; };
  } catch (e) { /* IndexedDB may be unavailable in file:// */ }
  // share link in hash
  const hash = location.hash || '';
  if (hash.startsWith('#p=')) {
    try {
      const loaded = await decodeShare(hash.slice(3));
      if (loaded && loaded.files) {
        setProject(loaded, 'Из ссылки');
        toast('Проект загружен из ссылки (режим только для чтения)', 'ok', 'Шаринг');
        state.readOnly = !!loaded.readOnly;
        return true;
      }
    } catch (e) { console.warn('share decode', e); }
  }
  const rawSettings = localStorage.getItem(LS_SETTINGS);
  if (rawSettings) {
    try { Object.assign(state.settings, JSON.parse(rawSettings)); } catch (e) { }
  }
  const raw = localStorage.getItem(LS_KEY);
  if (raw) {
    try {
      const data = JSON.parse(raw);
      setProject(data, data.projectName, true);
      return false;
    } catch (e) { console.warn('session restore failed', e); }
  }
  // try IndexedDB later (async); meanwhile use defaults
  resetProject();
  loadFromIDB().then(d => {
    if (d && d.files && !localStorage.getItem(LS_KEY)) setProject(d, d.projectName, true);
  });
  return false;
}

function idbPut(key, val) {
  return new Promise(res => {
    if (!db) return res(false);
    try {
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(val, key);
      tx.oncomplete = () => res(true); tx.onerror = () => res(false);
    } catch (e) { res(false); }
  });
}
function idbGet(key) {
  return new Promise(res => {
    if (!db) return setTimeout(() => idbGet(key).then(res), 250);
    try {
      const tx = db.transaction('kv', 'readonly');
      const r = tx.objectStore('kv').get(key);
      r.onsuccess = () => res(r.result || null); r.onerror = () => res(null);
    } catch (e) { res(null); }
  });
}
export const loadFromIDB = () => idbGet('project');

export function setProject(data, name, restoreEditors = false) {
  state.files = {};
  for (const [p, f] of Object.entries(data.files || {})) {
    state.files[p] = typeof f === 'string' ? makeFile(f, p) : { ...makeFile(f.content ?? '', p), ...f };
  }
  if (!Object.keys(state.files).length) resetProject();
  state.entry = data.entry || ('index.html' in state.files ? 'index.html' : Object.keys(state.files)[0]);
  state.projectName = name || data.projectName || 'Мой проект';
  state.panes = { ...state.panes, ...(data.panes || {}) };
  state.deps = data.deps || [];
  state.layout = data.layout || 'columns';
  state.snapshots = data.snapshots || [];
  state.userSnippets = data.userSnippets || [];
  state.progress = data.progress || {};
  if (data.settings) Object.assign(state.settings, data.settings);
  const pn = $('#projectName'); if (pn) pn.value = state.projectName;
  emit('project:loaded');
  if (restoreEditors) emit('project:restoreEditors');
}
export function resetProject() {
  state.files = {};
  for (const [p, c] of Object.entries(DEFAULT_FILES)) state.files[p] = makeFile(c, p);
  state.entry = 'index.html';
  state.panes = { html: 'index.html', css: 'style.css', js: 'script.js' };
  state.deps = []; state.snapshots = []; state.dirty = false;
  emit('project:loaded'); emit('project:restoreEditors');
}
export function makeFile(content, path = '') {
  return {
    content: String(content ?? ''), kind: isBinary(path) ? 'binary' : 'text',
    mime: mimeOf(path), size: String(content ?? '').length,
    updated: Date.now()
  };
}
export function mimeOf(p) {
  const e = (p.split('.').pop() || '').toLowerCase();
  return ({
    html: 'text/html', htm: 'text/html', css: 'text/css', js: 'text/javascript',
    mjs: 'text/javascript', ts: 'text/typescript', jsx: 'text/jsx', tsx: 'text/tsx',
    json: 'application/json', md: 'text/markdown', svg: 'image/svg+xml',
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    webp: 'image/webp', ico: 'image/x-icon', woff: 'font/woff', woff2: 'font/woff2',
    ttf: 'font/ttf', otf: 'font/otf', mp3: 'audio/mpeg', wav: 'audio/wav',
    mp4: 'video/mp4', webm: 'video/webm', txt: 'text/plain', scss: 'text/x-scss',
    pug: 'text/x-pug', vue: 'text/x-vue', xml: 'application/xml'
  })[e] || 'application/octet-stream';
}
export function isBinary(p) { return /^data:/.test((state.files[p]?.content || '')) && !/^data:(text|application\/json|image\/svg)/.test(state.files[p]?.content || ''); }
export function isImage(p) { return /^image\//.test(mimeOf(p)); }
export function isText(p) {
  return /\.(html?|css|js|mjs|cjs|ts|jsx|tsx|json|md|svg|txt|scss|less|pug|vue|xml|map)$/i.test(p);
}
export function read(p) { return state.files[p]?.content ?? ''; }
export function exists(p) { return Object.prototype.hasOwnProperty.call(state.files, p); }
export function write(p, content, opts = {}) {
  const isNew = !exists(p);
  state.files[p] = makeFile(content, p);
  if (opts.keepPane !== true) {
    for (const [pane, file] of Object.entries(state.panes)) {
      if (file === p && pane !== opts.fromPane) emit('file:externalChange', { path: p, pane, content });
    }
  }
  markDirty(true);
  emit('files:changed', { path: p, isNew });
  emit('project:size');
  schedulePersist();
  return state.files[p];
}
export function remove(p, opts = {}) {
  const kids = Object.keys(state.files).filter(x => x === p || x.startsWith(p + '/'));
  for (const k of kids) delete state.files[k];
  for (const [pane, file] of Object.entries(state.panes)) {
    if (kids.includes(file)) {
      const candidates = Object.keys(state.files).filter(x => paneOf(x) === pane);
      state.panes[pane] = candidates[0] || '';
      emit('project:restoreEditors');
    }
  }
  markDirty(true); emit('files:changed', { path: p, removed: true }); emit('project:size');
  schedulePersist();
  if (!opts.silent) emit('toast', { msg: `Удалено: ${p}`, type: 'ok' });
}
export function rename(oldP, newP) {
  if (oldP === newP || !exists(oldP)) return false;
  const kids = Object.keys(state.files).filter(x => x === oldP || x.startsWith(oldP + '/'));
  // update references in text files
  const oldBase = oldP.split('/').pop();
  const newBase = newP.split('/').pop();
  for (const [p, f] of Object.entries(state.files)) {
    if (!isText(p)) continue;
    let c = f.content;
    c = c.split(`"${oldP}"`).join(`"${newP}"`).split(`'${oldP}'`).join(`'${newP}'`);
    if (oldBase !== newBase) c = c.split(`"${oldBase}"`).join(`"${newBase}"`).split(`'${oldBase}'`).join(`'${newBase}'`);
    f.content = c; f.size = c.length;
  }
  for (const k of kids) {
    const target = newP + k.slice(oldP.length);
    state.files[target] = state.files[k]; state.files[target].mime = mimeOf(target);
    delete state.files[k];
    for (const [pane, file] of Object.entries(state.panes)) if (file === k) state.panes[pane] = target;
  }
  if (state.entry === oldP) state.entry = newP;
  state.activeFile = newP;
  markDirty(true); emit('files:changed', { path: newP, renamed: true });
  emit('project:restoreEditors'); schedulePersist();
  return true;
}
export function copyFile(p) {
  const ext = p.includes('.') ? '.' + p.split('.').pop() : '';
  let n = p.replace(ext, '-copy' + ext), i = 2;
  while (exists(n)) n = p.replace(ext, `-copy${i++}${ext}`);
  state.files[n] = { ...makeFile(read(p), n) };
  markDirty(true); emit('files:changed', { path: n }); schedulePersist();
  return n;
}
export function paneOf(path) {
  const e = (path.split('.').pop() || '').toLowerCase();
  if (['html', 'htm', 'pug', 'vue', 'svg'].includes(e)) return 'html';
  if (['css', 'scss', 'less', 'sass'].includes(e)) return 'css';
  if (['js', 'mjs', 'cjs', 'ts', 'jsx', 'tsx', 'json'].includes(e)) return 'js';
  return null;
}
export function listFiles() { return Object.keys(state.files).sort(); }
export function allTextFiles() {
  const out = {};
  for (const [p, f] of Object.entries(state.files)) if (isText(p)) out[p] = f.content;
  return out;
}
export function projectSize() {
  return Object.values(state.files).reduce((n, f) => n + (f.content?.length || 0), 0);
}
export function projectJSON() {
  return JSON.stringify({
    version: 2, projectName: state.projectName, entry: state.entry,
    files: state.files, panes: state.panes, deps: state.deps, layout: state.layout,
    snapshots: state.snapshots, userSnippets: state.userSnippets,
    settings: state.settings, progress: state.progress
  }, null, 2);
}
export function importProjectJSON(text) {
  const d = typeof text === 'string' ? JSON.parse(text) : text;
  const files = {};
  for (const [p, f] of Object.entries(d.files || d)) files[p] = typeof f === 'string' ? f : (f.content || '');
  setProject({ ...d, files }, d.projectName, true);
  schedulePersist();
  return true;
}

/* ── persistence ─────────────────────────────────────────────────── */
export const persistNow = () => {
  try {
    const data = {
      projectName: state.projectName, entry: state.entry, files: state.files,
      panes: state.panes, deps: state.deps, layout: state.layout,
      snapshots: state.snapshots.slice(0, 20), userSnippets: state.userSnippets,
      progress: state.progress, savedAt: Date.now()
    };
    localStorage.setItem(LS_KEY, JSON.stringify(data));
    localStorage.setItem(LS_SETTINGS, JSON.stringify(state.settings));
    idbPut('project', data);
    if (projectSize() > 4.5 * 1024 * 1024) {
      toast('Проект приблизился к лимиту хранилища (>4.5 МБ) — выгрузите большие ассеты', 'warn', 'Хранилище');
    }
    state.dirty = false;
    emit('saved');
    return true;
  } catch (e) {
    toast('Не удалось сохранить: ' + e.message, 'err', 'Хранилище');
    return false;
  }
};
export const schedulePersist = debounce(() => { if (state.settings.autoSave) persistNow(); }, 900);
export function startAutoSave() {
  setInterval(() => {
    if (state.settings.autoSave && state.dirty) { persistNow(); emit('webhook', 'save'); }
  }, Math.max(5, state.settings.autoSaveInterval) * 1000);
}

/* ── snapshots / versions ─────────────────────────────────────────── */
export function makeSnapshot(label = 'Версия') {
  const snap = {
    id: Date.now().toString(36), label, at: Date.now(),
    files: Object.fromEntries(Object.entries(state.files).map(([p, f]) => [p, f.content])),
    entry: state.entry, panes: { ...state.panes }
  };
  state.snapshots.unshift(snap);
  if (state.snapshots.length > 25) state.snapshots.length = 25;
  schedulePersist(); emit('snapshots');
  return snap;
}
export function restoreSnapshot(id) {
  const s = state.snapshots.find(x => x.id === id); if (!s) return false;
  setProject({ files: s.files, entry: s.entry, panes: s.panes }, state.projectName, true);
  return true;
}
export function diffText(a, b) {
  const A = a.split('\n'), B = b.split('\n');
  const dp = Array.from({ length: A.length + 1 }, () => new Uint16Array(B.length + 1));
  for (let i = A.length - 1; i >= 0; i--)
    for (let j = B.length - 1; j >= 0; j--)
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = []; let i = 0, j = 0;
  while (i < A.length && j < B.length) {
    if (A[i] === B[j]) { out.push({ t: '=', v: A[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ t: '-', v: A[i++] }); }
    else { out.push({ t: '+', v: B[j++] }); }
  }
  while (i < A.length) out.push({ t: '-', v: A[i++] });
  while (j < B.length) out.push({ t: '+', v: B[j++] });
  return out;
}

/* ── settings presets ─────────────────────────────────────────────── */
export const PRESETS = {
  minimal: { label: 'Минимализм', patch: { fontSize: 13, density: 'compact', minimap: false, showWhitespace: false, wrap: true, autoAnalyze: false, theme: 'dark' } },
  balanced: { label: 'Баланс', patch: { fontSize: 13, density: 'comfy', minimap: true, showWhitespace: false, wrap: false, autoAnalyze: true, autoRun: true } },
  pro: { label: 'Pro / плотный', patch: { fontSize: 12, density: 'compact', minimap: true, showWhitespace: true, wrap: false, tabSize: 2, showInvisibles: true, autoAnalyze: true, autoRunDelay: 350 } },
  teacher: { label: 'Для обучения', patch: { fontSize: 16, density: 'comfy', minimap: false, wrap: true, showWhitespace: true, theme: 'light', autoAnalyze: true } }
};
export function applyPreset(name) {
  const p = PRESETS[name]; if (!p) return;
  Object.assign(state.settings, p.patch); state.settings.presets = name;
  applySettings(); toast('Применён пресет «' + p.label + '»', 'ok', 'Настройки');
}
export function applySettings() {
  applyTheme(); applyLocale();
  localStorage.setItem(LS_SETTINGS, JSON.stringify(state.settings));
  emit('settings:changed'); schedulePersist();
}
export function exportSettings() { return JSON.stringify(state.settings, null, 2); }
export function importSettings(text) {
  const d = JSON.parse(text); Object.assign(state.settings, d); applySettings();
  return true;
}
export function resetSettings() {
  Object.assign(state.settings, JSON.parse(JSON.stringify(DEFAULT_SETTINGS)));
  applySettings(); toast('Настройки сброшены', 'ok');
}

/* ── share link codec (deflate + base64url) ───────────────────────── */
export async function encodeShare(opts = {}) {
  const payload = {
    files: Object.fromEntries(Object.entries(state.files).map(([p, f]) => [p, f.content])),
    entry: state.entry, panes: state.panes, deps: state.deps,
    projectName: state.projectName, readOnly: !!opts.readOnly,
    password: opts.password || null, v: 2
  };
  const bytes = deflateSync(strToU8(JSON.stringify(payload)), { level: 9 });
  let bin = ''; for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export async function decodeShare(code) {
  const b64 = code.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '==='.slice((b64.length + 3) % 4));
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
  return JSON.parse(strFromU8(inflateSync(bytes)));
}
