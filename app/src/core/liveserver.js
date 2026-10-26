/* Live Server — a local HTTP server for the virtual project, like the VSCode
   extension. Real relative URLs, ES modules, fetch and CSS @import work, and
   the page reloads automatically when files change.
   Electron: native HTTP server in main process over IPC.
   Browser: same-origin /live/* endpoints on scripts/serve.mjs. */
import { state, ctx, $, emit, on, toast, debounce } from './core.js';
import { allTextFiles, read, exists } from './state.js';
import { icon } from './icons.js';

const status = { running: false, url: '', port: 5500, version: 0, mode: 'local' };
let lastPayload = '';

export function liveStatus() { return { ...status }; }
function apiToken() {
  const m = document.querySelector('meta[name="runlet-api-token"]');
  const t = m?.getAttribute('content') || '';
  return /^[a-f0-9]{32,128}$/i.test(t) ? t : '';
}
function projectPayload() {
  const files = {};
  let total = 0;
  for (const [p, f] of Object.entries(state.files)) {
    if (typeof p !== 'string' || typeof f?.content !== 'string') continue;
    total += f.content.length;
    if (total > 6 * 1024 * 1024) break;
    files[p] = f.content;
  }
  return { files, entry: state.entry || 'index.html' };
}
function updateBar() {
  const st = $('#liveState'), url = $('#liveUrl');
  if (st) {
    st.classList.toggle('on', status.running);
    st.innerHTML = `<i></i><span>${status.running ? 'Live Server включён' : 'Live Server выкл'}</span>`;
  }
  if (url) { url.textContent = status.running ? status.url : '—'; url.title = status.running ? status.url : ''; }
  emit('live:changed', { ...status });
}

export async function startLiveServer() {
  const payload = projectPayload();
  try {
    if (window.runlet?.liveStart) {
      const port = state.settings.livePort || 5500;
      const res = await window.runlet.liveStart({ port, project: payload });
      if (!res?.ok) throw new Error(res?.error || 'не удалось запустить сервер');
      status.running = true; status.url = res.url; status.port = res.port || port; status.mode = 'electron';
    } else {
      const res = await fetch('/api/live/project', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(apiToken() ? { 'X-Runlet-Token': apiToken() } : {}) },
        body: JSON.stringify(payload)
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || ('HTTP ' + res.status));
      status.running = true;
      status.url = new URL(j.url || '/live/', location.href).href;
      status.port = j.port || 0; status.mode = 'browser';
    }
    lastPayload = JSON.stringify(payload);
    updateBar();
    toast('Live Server запущен: ' + status.url, 'ok');
    emit('live:started', { ...status });
    return status;
  } catch (e) {
    status.running = false; updateBar();
    toast('Live Server: ' + e.message, 'err');
    return status;
  }
}
export async function stopLiveServer() {
  try {
    if (window.runlet?.liveStop) await window.runlet.liveStop();
    else await fetch('/api/live/project', {
      method: 'DELETE',
      headers: { ...(apiToken() ? { 'X-Runlet-Token': apiToken() } : {}) }
    });
  } catch (_) { /* ignore */ }
  status.running = false; status.url = ''; lastPayload = '';
  updateBar(); emit('live:stopped', { ...status });
  toast('Live Server остановлен', 'info');
  return status;
}
export function toggleLiveServer() { return status.running ? stopLiveServer() : startLiveServer(); }

export async function pushLiveFiles() {
  if (!status.running) return;
  const payload = projectPayload();
  const packed = JSON.stringify(payload);
  if (packed === lastPayload) return;
  lastPayload = packed;
  try {
    if (window.runlet?.liveUpdate) {
      const res = await window.runlet.liveUpdate({ project: payload });
      if (res?.ok) status.version = res.version || status.version + 1;
    } else {
      const res = await fetch('/api/live/project', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(apiToken() ? { 'X-Runlet-Token': apiToken() } : {}) },
        body: packed
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok) status.version = j.version || status.version + 1;
    }
  } catch (e) { /* server might be down */ }
}

export function openSiteWindow() {
  if (status.running && status.url) return ctx.openSiteWindowRaw?.(status.url, null);
  toast('Live Server выключен — открываю предпросмотр в окне', 'info');
  return ctx.openSiteWindowRaw?.(null, ctx.srcdoc?.());
}
export function openSiteExternal() {
  if (!status.running || !status.url) { toast('Сначала запустите Live Server', 'warn'); return; }
  if (window.runlet?.liveExternal) {
    window.runlet.liveExternal(status.port).then(ok => { if (!ok) toast('Не удалось открыть браузер', 'err'); });
  } else {
    const w = window.open(status.url, '_blank', 'noopener,noreferrer');
    if (!w) toast('Браузер заблокировал новое окно', 'err');
  }
}
export function liveServerDialog() {
  const port = state.settings.livePort || 5500;
  ctx.modal({
    title: 'Live Server', narrow: true,
    body: `<div class="beginner">Локальный сервер отдаёт файлы проекта по настоящим адресам.
      Относительные пути, ES-модули и <code class="inline">fetch()</code> работают как на реальном сайте.
      При изменении кода страница обновляется сама.</div>
      <div class="field mt8"><label>Порт (Electron)</label><input id="livePort" type="number" value="${port}" min="1024" max="65535"></div>
      <div class="list-rows mt8">
        <div class="list-row"><b>Статус</b><div class="grow" style="text-align:right">${status.running ? 'включён' : 'выключен'}</div></div>
        <div class="list-row"><b>Адрес</b><div class="grow" style="text-align:right;font:10px var(--mono)">${status.running ? status.url : '—'}</div></div>
      </div>
      <div class="rowflex mt8"><button class="mini-btn" id="liveToggle">${status.running ? 'Остановить' : 'Запустить'}</button>
        <button class="mini-btn" id="liveOpen">Открыть в окне</button><button class="mini-btn" id="liveExt">В браузере</button></div>`,
    okText: 'Готово',
    onMount: root => {
      root.querySelector('#liveToggle').onclick = async () => {
        const p = +root.querySelector('#livePort').value || 5500;
        state.settings.livePort = Math.max(1024, Math.min(65535, p));
        ctx.applySettings?.();
        await toggleLiveServer(); ctx.closeModal?.();
      };
      root.querySelector('#liveOpen').onclick = () => { openSiteWindow(); ctx.closeModal?.(); };
      root.querySelector('#liveExt').onclick = () => { openSiteExternal(); ctx.closeModal?.(); };
    }
  });
}
export function initLiveServer() {
  updateBar();
  on('files:changed', debounce(() => pushLiveFiles(), 450));
  on('project:opened', () => { if (status.running) pushLiveFiles(); });
  ctx.liveStatus = liveStatus;
  ctx.openSiteWindow = openSiteWindow;
  ctx.pushLiveFiles = pushLiveFiles;
  emit('live:ready');
}
