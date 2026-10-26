/* Safe bridge between the sandboxed renderer and Electron's main process. */
const { contextBridge, ipcRenderer } = require('electron');

const CHANNELS = new Set([
  'analyze', 'app:info', 'fs:open', 'fs:save', 'fs:read', 'fs:write',
  'fs:list', 'win:control', 'shell:open', 'project:export', 'python:check'
]);

contextBridge.exposeInMainWorld('runlet', {
  isElectron: true,
  platform: process.platform,
  versions: { electron: process.versions.electron, node: process.versions.node, chrome: process.versions.chrome },

  analyze: job => ipcRenderer.invoke('analyze', job),
  invoke: (channel, ...args) => {
    if (!CHANNELS.has(channel)) return Promise.reject(new Error('channel not allowed: ' + channel));
    return ipcRenderer.invoke(channel, ...args);
  },
  windowControl: action => ipcRenderer.invoke('win:control', action),
  openFile: () => ipcRenderer.invoke('fs:open'),
  saveFile: (name, content) => ipcRenderer.invoke('fs:save', { name, content }),
  readFile: file => ipcRenderer.invoke('fs:read', file),
  writeFile: (file, content) => ipcRenderer.invoke('fs:write', { file, content }),
  openExternal: url => ipcRenderer.invoke('shell:open', url),
  onMenu: cb => ipcRenderer.on('menu:command', (_, id) => cb(id)),
  pythonCheck: () => ipcRenderer.invoke('python:check')
});
