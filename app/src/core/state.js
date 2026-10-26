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
  // Share link in hash — bounded, validated, optionally password-encrypted.
  const hash = location.hash || '';
  if (hash.startsWith('#p=')) {
    const code = hash.slice(3);
    if (code.length <= 2_000_000) {
      let loaded = null, shareError = null;
      try { loaded = await decodeShare(code); }
      catch (e) {
        if (e.code === 'PASSWORD_REQUIRED') {
          const pass = await askPassword();
          if (pass) { try { loaded = await decodeShare(code, pass); } catch (e2) { shareError = e2; } }
        } else shareError = e;
      }
      if (loaded && loaded.files) {
        state.readOnly = !!loaded.readOnly;
        setProject(loaded, loaded.projectName || 'Из ссылки');
        toast(state.readOnly ? 'Проект загружен из ссылки (режим только для чтения)' : 'Проект загружен из ссылки', 'ok', 'Шаринг');
        emit('readOnly:changed', state.readOnly);
        return true;
      }
      toast('Не удалось открыть ссылку: ' + (shareError?.message || 'повреждённые данные'), 'err', 'Шаринг');
    } else toast('Ссылка на проект слишком длинная', 'err', 'Шаринг');
  }
  const rawSettings = localStorage.getItem(LS_SETTINGS);
  if (rawSettings) {
    try { Object.assign(state.settings, sanitizeSettings(JSON.parse(rawSettings))); } catch (e) { }
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

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
export function safePathKey(p, maxLen = 300) {
  if (typeof p !== 'string' || !p || p.length > maxLen || p.includes('\0') ||
      p.includes('\\') || p.startsWith('/') || /^[A-Za-z]:/.test(p) ||
      UNSAFE_KEYS.has(p)) return null;
  const parts = p.split('/');
  if (parts.some(x => x === '..' || x === '.' || x === '' || UNSAFE_KEYS.has(x) || /^\s|\s$/.test(x))) return null;
  if (!/[\w.-]/.test(p) || /[<>:"|?*\x00-\x1f]/.test(p)) return null;
  return p;
}
export function setProject(data, name, restoreEditors = false) {
  state.files = {};
  for (const [p, f] of Object.entries(data.files || {})) {
    const key = safePathKey(p);
    if (!key) continue;                        // blocks prototype pollution
    state.files[key] = typeof f === 'string' ? makeFile(f, key) : makeFile(String(f?.content ?? ''), key);
  }
  if (!Object.keys(state.files).length) resetProject();
  state.entry = data.entry || ('index.html' in state.files ? 'index.html' : Object.keys(state.files)[0]);
  state.projectName = name || data.projectName || 'Мой проект';
  const mergedPanes = { ...state.panes, ...(data.panes || {}) };
  state.panes = Object.fromEntries(Object.entries(mergedPanes).map(([k, v]) =>
    [k, (['html', 'css', 'js'].includes(k) && safePathKey(v)) ? v : (state.panes[k] || '')]));
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
  const key = safePathKey(p);
  if (!key) { if (!opts.quiet) toast('Недопустимое имя файла — путь отклонён', 'err', 'Безопасность'); return null; }
  p = key;
  if (typeof content !== 'string' || content.length > 8 * 1024 * 1024) {
    toast('Файл слишком большой или не текстовый', 'err'); return null;
  }
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
  const from = safePathKey(oldP), to = safePathKey(newP);
  if (!from || !to || from === to || !exists(from)) return false;
  oldP = from; newP = to;
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
  if (!d || typeof d !== 'object' || Array.isArray(d)) throw new Error('Некорректный проект');
  const files = {};
  let total = 0;
  for (const [p, f] of Object.entries(d.files || d)) {
    const key = safePathKey(p);
    const content = typeof f === 'string' ? f : String(f?.content ?? '');
    total += content.length;
    if (key && total < 8 * 1024 * 1024) files[key] = content.slice(0, 2 * 1024 * 1024);
  }
  setProject({ ...d, files }, String(d.projectName || 'Проект').slice(0, 200), true);
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
export function sanitizeSettings(d) {
  // Imported settings JSON is untrusted: keep only known keys and sane types.
  const out = {};
  if (!d || typeof d !== 'object' || Array.isArray(d)) return out;
  const ref = DEFAULT_SETTINGS;
  for (const [k, v] of Object.entries(d)) {
    if (UNSAFE_KEYS.has(k) || !Object.prototype.hasOwnProperty.call(ref, k)) continue;
    const orig = ref[k];
    if (typeof orig === 'boolean' && typeof v === 'boolean') out[k] = v;
    else if (typeof orig === 'number' && typeof v === 'number' && Math.abs(v) < 1e7) out[k] = v;
    else if (typeof orig === 'string' && typeof v === 'string' && v.length < 200) out[k] = v;
    else if (Array.isArray(orig) && Array.isArray(v)) out[k] = v.slice(0, 100);
    else if (orig && typeof orig === 'object' && !Array.isArray(orig) && v && typeof v === 'object' && !Array.isArray(v)) {
      const nested = {};
      for (const [nk, nv] of Object.entries(v)) {
        if (UNSAFE_KEYS.has(nk) || !Object.prototype.hasOwnProperty.call(orig, nk)) continue;
        if (typeof orig[nk] === typeof nv && (typeof nv === 'boolean' || typeof nv === 'number' || (typeof nv === 'string' && nv.length < 200))) nested[nk] = nv;
      }
      out[k] = { ...orig, ...nested };
    }
  }
  return out;
}
export function importSettings(text) {
  Object.assign(state.settings, sanitizeSettings(JSON.parse(text)));
  applySettings();
  return true;
}
export function resetSettings() {
  Object.assign(state.settings, JSON.parse(JSON.stringify(DEFAULT_SETTINGS)));
  applySettings(); toast('Настройки сброшены', 'ok');
}

/* ── share link codec (deflate + optional AES-GCM) ───────────────────
   v3: plain = base64url(deflate(json)); encrypted = "E" + salt.iv.cipher.
   Password links are actually encrypted with PBKDF2(150k)+AES-GCM, not just
   "gated" client-side. Input sizes are capped to stop decompression bombs. */
const MAX_SHARE_CODE = 2_000_000;
const MAX_SHARE_JSON = 4 * 1024 * 1024;
const SHARE_PBKDF2_ITER = 150000;

function toB64u(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64u(code) {
  const b64 = code.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '==='.slice((b64.length + 3) % 4));
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}
async function shareKey(password, salt) {
  if (!globalThis.crypto?.subtle) throw new Error('Web Crypto недоступен — парольная ссылка не поддерживается');
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: SHARE_PBKDF2_ITER, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
function validateShared(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p) || !p.files || typeof p.files !== 'object' || Array.isArray(p.files))
    throw new Error('Некорректный формат проекта');
  const files = {};
  let total = 0;
  for (const [k, v] of Object.entries(p.files).slice(0, 200)) {
    const key = safePathKey(k);
    if (!key || typeof v !== 'string') continue;
    total += v.length;
    if (total > MAX_SHARE_JSON) throw new Error('Проект в ссылке слишком большой');
    files[key] = v.slice(0, 2 * 1024 * 1024);
  }
  if (!Object.keys(files).length) throw new Error('В ссылке нет файлов');
  return {
    v: 3, files,
    entry: safePathKey(p.entry) || Object.keys(files)[0],
    panes: { ...state.panes, ...(p.panes && typeof p.panes === 'object' ? Object.fromEntries(
      Object.entries(p.panes).filter(([k, v]) => ['html', 'css', 'js'].includes(k) && typeof v === 'string' && safePathKey(v))) : {}) },
    deps: Array.isArray(p.deps) ? p.deps.filter(d => typeof d === 'string' && d.length < 80).slice(0, 50) : [],
    projectName: typeof p.projectName === 'string' ? p.projectName.slice(0, 200) : 'Из ссылки',
    readOnly: !!p.readOnly
  };
}
export async function encodeShare(opts = {}) {
  const payload = validateShared({
    v: 3,
    files: Object.fromEntries(Object.entries(state.files).map(([p, f]) => [p, f.content])),
    entry: state.entry, panes: state.panes, deps: state.deps,
    projectName: state.projectName, readOnly: !!opts.readOnly
  });
  const bytes = deflateSync(strToU8(JSON.stringify(payload)), { level: 9 });
  if (bytes.length > MAX_SHARE_JSON) throw new Error('Проект слишком большой для ссылки');
  if (opts.password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await shareKey(String(opts.password).slice(0, 200), salt);
    const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes));
    const code = 'E' + toB64u(salt) + '.' + toB64u(iv) + '.' + toB64u(cipher);
    if (code.length > MAX_SHARE_CODE) throw new Error('Проект слишком большой для ссылки');
    return code;
  }
  return toB64u(bytes);
}
export async function decodeShare(code, password = null) {
  if (typeof code !== 'string' || !code || code.length > MAX_SHARE_CODE || !/^[A-Za-z0-9._-]+$/.test(code))
    throw new Error('Некорректная ссылка');
  let bytes;
  if (code.startsWith('E')) {
    if (!password) { const e = new Error('Требуется пароль'); e.code = 'PASSWORD_REQUIRED'; throw e; }
    const parts = code.slice(1).split('.');
    if (parts.length !== 3) throw new Error('Повреждённая ссылка');
    const salt = fromB64u(parts[0]), iv = fromB64u(parts[1]), cipher = fromB64u(parts[2]);
    if (salt.length !== 16 || iv.length !== 12 || cipher.length > MAX_SHARE_JSON) throw new Error('Повреждённая ссылка');
    const key = await shareKey(String(password).slice(0, 200), salt);
    try { bytes = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher)); }
    catch (_) { throw new Error('Неверный пароль'); }
  } else bytes = fromB64u(code);
  if (bytes.length > MAX_SHARE_JSON) throw new Error('Ссылка слишком большая');
  // Preallocated output buffer caps decompression (no zip-bomb allocation).
  const out = inflateSync(bytes, { out: new Uint8Array(MAX_SHARE_JSON) });
  const json = strFromU8(out);
  if (json.length > MAX_SHARE_JSON) throw new Error('Проект слишком большой');
  return validateShared(JSON.parse(json));
}
/** Minimal password prompt that works before the modal system is initialised. */
export function askPassword() {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;display:grid;place-items:center;background:rgba(4,5,14,.88);font:14px system-ui;color:#fff';
    const card = document.createElement('div');
    card.style.cssText = 'background:#181b2c;border:1px solid #ffffff22;border-radius:20px;padding:24px;width:min(380px,92vw);box-shadow:0 20px 60px #0008';
    const h = document.createElement('h2'); h.textContent = '🔒 Проект защищён паролем'; h.style.cssText = 'margin:0 0 8px;font-size:18px';
    const p = document.createElement('p'); p.textContent = 'Ссылка зашифрована AES-GCM. Введите пароль, чтобы открыть проект.'; p.style.cssText = 'color:#979cb9;font-size:12px;line-height:1.5';
    const input = document.createElement('input');
    input.type = 'password'; input.placeholder = 'Пароль';
    input.style.cssText = 'width:100%;height:38px;border-radius:11px;border:1px solid #ffffff33;background:#121424;color:#fff;padding:0 12px;outline:0';
    const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:8px;margin-top:12px';
    const ok = document.createElement('button'); ok.textContent = 'Открыть';
    ok.style.cssText = 'flex:1;height:36px;border:0;border-radius:11px;background:#7c6cf6;color:#fff;font-weight:700';
    const cancel = document.createElement('button'); cancel.textContent = 'Отмена';
    cancel.style.cssText = 'height:36px;padding:0 14px;border:1px solid #ffffff33;border-radius:11px;background:transparent;color:#ccc';
    const finish = v => { overlay.remove(); resolve(v); };
    ok.onclick = () => finish(input.value);
    cancel.onclick = () => finish('');
    input.onkeydown = e => { if (e.key === 'Enter') finish(input.value); if (e.key === 'Escape') finish(''); };
    row.append(ok, cancel); card.append(h, p, input, row); overlay.appendChild(card);
    document.body.appendChild(overlay); input.focus();
  });
}
export function setReadOnly(v) {
  state.readOnly = !!v;
  emit('readOnly:changed', state.readOnly);
}
