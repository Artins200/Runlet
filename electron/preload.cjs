/* Minimal, validated contextBridge surface. Runs inside the sandboxed preload. */
const { contextBridge, ipcRenderer } = require('electron');

// Only these channels exist in the main process. Anything else is rejected
// before it ever reaches ipcRenderer.invoke.
const CHANNELS = new Set([
  'analyze', 'app:info', 'fs:open', 'fs:save', 'fs:read', 'fs:write',
  'win:control', 'shell:open', 'python:check', 'preview:popout'
]);

const str = (v, max = 4 * 1024 * 1024) =>
  typeof v === 'string' && v.length <= max && !v.includes('\0') ? v : null;

function cleanJob(job) {
  if (!job || typeof job !== 'object' || Array.isArray(job)) return null;
  const files = job.files;
  if (!files || typeof files !== 'object' || Array.isArray(files)) return null;
  const out = { files: {}, entry: str(job.entry, 300), deps: [], locale: str(job.locale, 8) };
  for (const [k, v] of Object.entries(files)) {
    if (typeof k !== 'string' || k.length > 300 || k.includes('\\') || typeof v !== 'string' || v.length > 2 * 1024 * 1024) return null;
    out.files[k] = v;
  }
  if (Array.isArray(job.deps)) out.deps = job.deps.filter(d => typeof d === 'string' && d.length < 80).slice(0, 50);
  return out;
}

const api = {
  isElectron: true,
  platform: process.platform,
  versions: Object.freeze({
    electron: process.versions.electron || '45', node: process.versions.node || '', chrome: process.versions.chrome || ''
  }),

  analyze: job => {
    const clean = cleanJob(job);
    return clean ? ipcRenderer.invoke('analyze', clean) : Promise.reject(new Error('invalid analysis job'));
  },
  invoke: (channel, ...args) => {
    if (typeof channel !== 'string' || !CHANNELS.has(channel)) return Promise.reject(new Error('channel not allowed'));
    return ipcRenderer.invoke(channel, ...args);
  },
  windowControl: action =>
    ['minimize', 'maximize', 'close'].includes(action) ? ipcRenderer.invoke('win:control', action) : Promise.resolve(false),
  openFile: () => ipcRenderer.invoke('fs:open'),
  saveFile: (name, content) => {
    const c = str(content);
    return c === null ? Promise.resolve(false) : ipcRenderer.invoke('fs:save', { name: str(name, 180), content: c });
  },
  readFile: file => { const f = str(file, 512); return f ? ipcRenderer.invoke('fs:read', f) : Promise.resolve(null); },
  writeFile: (file, content) => {
    const f = str(file, 180), c = str(content);
    return f && c !== null ? ipcRenderer.invoke('fs:write', { file: f, content: c }) : Promise.resolve(false);
  },
  openExternal: url => { const u = str(url, 2048); return u ? ipcRenderer.invoke('shell:open', u) : Promise.resolve(false); },
  popout: html => { const h = str(html, 8 * 1024 * 1024); return h ? ipcRenderer.invoke('preview:popout', h) : Promise.resolve(false); },
  onMenu: cb => {
    if (typeof cb !== 'function') return;
    ipcRenderer.on('menu:command', (_, id) => { if (typeof id === 'string' && id.length < 80) cb(id); });
  },
  pythonCheck: () => ipcRenderer.invoke('python:check'),
  // The REST token is deliberately NOT exposed to the renderer: it lives in
  // userData/api-token (0600) and is only needed by the local CLI.
};

Object.freeze(api);
contextBridge.exposeInMainWorld('runlet', api);
