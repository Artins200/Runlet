/* Runlet bootstrap. Works both inside Electron and as a standalone web app. */
import { state, ctx, on, emit, $, $$, toast, debounce, registerCommand, DEFAULT_SETTINGS,
         runCommand, commands } from './core/core.js';
import { initStorage, startAutoSave, persistNow, projectJSON, listFiles, read, write, exists } from './core/state.js';
import { initEditors, applyEditorSettings, setPaneFile, goto, getDoc, setDoc, focusPane } from './core/editor.js';
import { initPreview, run, applyDevice, refreshInspectors, send } from './core/preview.js';
import { initFiles, renderTree, openFile, renderLibs, renderAssets } from './core/files.js';
import { initPanels, renderAnalysis, renderConsole, renderDebug } from './core/panels.js';
import { initAssistant } from './core/assistant.js';
import { initLearn, renderLearn, initPlugins, renderPlugins, initFeatures, pluginAPI } from './core/extras.js';
import { initCommands } from './core/commands.js';
import { initUI, applyLayout, modal, closeModal, selectInspTab, selectRailTab } from './core/ui.js';
import { runAnalysis, scheduleAnalysis } from './core/analyzer.js';
import { coverage } from './core/data.js';

const started = performance.now();

async function boot() {
  // context API used by modules to avoid circular imports
  Object.assign(ctx, {
    modal, closeModal, runCommand, registerCommand,
    setLayout: applyLayout, applyDevice, openFile, gotoLine: n => goto(state.activePane, n),
    refreshInspectors, selectInspTab, selectRailTab,
    collabSend: (type, data) => collab?.postMessage({ type, data, from: CLIENT_ID, at: Date.now() }),
    renderTree, renderLibs, renderAssets, renderAnalysis, renderConsole, renderDebug,
    applyEditorSettings, focusPane, getDoc, setDoc
  });

  const restored = await initStorage();
  state.settings = { ...JSON.parse(JSON.stringify(DEFAULT_SETTINGS)), ...state.settings };

  initEditors();
  initPreview();
  initFiles();
  initPanels();
  initAssistant();
  initLearn();
  initPlugins();
  initFeatures();
  initCommands();
  initUI();

  applyEditorSettings();
  applyLayout(state.layout);
  applyDevice();

  // cross-module reactions
  on('files:changed', () => {
    if (state.settings.autoAnalyze) analysisTimer();
    collab?.postMessage({ type: 'files', data: { files: state.files, panes: state.panes }, from: CLIENT_ID, at: Date.now() });
  });
  on('deps:changed', () => { run('full'); persistNow(); });
  on('settings:changed', () => { applyEditorSettings(); applyDevice(); });
  on('pane:active', p => { state.activeFile = state.panes[p]; });
  on('preview:ready', data => {
    state.perf = { ...state.perf, ...data };
    setTimeout(refreshInspectors, 350);
  });
  on('saved', async () => {
    if (!state.webhookUrl) return;
    try { await fetch(state.webhookUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event: 'save', project: state.projectName, at: Date.now() }) }); }
    catch (e) { /* CORS / offline */ }
  });
  on('learn:progress', () => { persistNow(); renderLearn(); });
  on('webhook', () => { /* hook point for plugins */ });

  startAutoSave();
  initCollaboration();
  initPWA();
  initNativeHooks();

  // first analysis
  setTimeout(() => runAnalysis({ silent: true }), 800);
  setTimeout(() => {
    const ms = Math.round(performance.now() - started);
    const ind = $('#readyIndicator');
    if (ind) ind.innerHTML = `<i></i>готов · ${ms} мс`;
    emit('ready', { ms, engine: state.engine });
  }, 1100);

  if (state.settings.firstRun && !restored) {
    setTimeout(() => toast('Подсказка: Ctrl+Shift+P — палитра команд, Ctrl+Enter — запуск, Ctrl+Shift+A — анализ кода', 'info', 'Первый запуск'), 1800);
  }
  window.Runlet = publicAPI();
  emit('boot');
}

let analysisHandle = null;
function analysisTimer() {
  clearTimeout(analysisHandle);
  analysisHandle = setTimeout(() => runAnalysis({ silent: true }), state.settings.autoAnalyzeDelay || 1600);
}

/* ── BroadcastChannel collaboration (same-origin tabs/windows) ── */
const CLIENT_ID = Math.random().toString(36).slice(2);
let collab = null;
function initCollaboration() {
  try { collab = new BroadcastChannel('runlet-collab'); } catch (e) { return; }
  collab.onmessage = e => {
    const m = e.data; if (!m || m.from === CLIENT_ID) return;
    if (m.type === 'files' && m.data?.files) {
      state.files = { ...state.files, ...m.data.files };
      emit('files:changed', { path: '(collab)' });
      emit('project:restoreEditors');
      toast('Синхронизировано от соавтора', 'info', 'Коллаборация');
    } else if (m.type === 'cursor') {
      state.collabPeers[m.from] = { ...m.data, at: Date.now() };
      emit('collab:presence', state.collabPeers);
    } else if (m.type === 'chat') {
      const chat = window.__collabChat;
      if (chat) chat.innerHTML += `<div><b>${(m.data?.name || 'Участник')}:</b> ${(m.data?.text || '').replace(/[<>&]/g, '')}</div>`;
      toast(`${m.data?.name || 'Соавтор'}: ${(m.data?.text || '').slice(0, 60)}`, 'info', 'Чат');
    }
  };
  on('cursor', d => collab?.postMessage({ type: 'cursor', data: d, from: CLIENT_ID, at: Date.now() }));
  setInterval(() => {
    for (const [k, v] of Object.entries(state.collabPeers)) if (Date.now() - v.at > 15000) delete state.collabPeers[k];
  }, 10000);
}

/* ── PWA ─────────────────────────────────────────────────────── */
function initPWA() {
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); window.__pwaPrompt = e; });
  window.addEventListener('online', () => { toast('Соединение восстановлено — проекты синхронизированы', 'ok'); persistNow(); });
  window.addEventListener('offline', () => toast('Офлайн-режим: редактор работает из кэша', 'warn'));
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => { });
  }
}

/* ── Electron native hooks ───────────────────────────────────── */
function initNativeHooks() {
  if (!window.runlet?.isElectron) return;
  window.runlet.onMenu?.(id => runCommand(id));
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === '=') { e.preventDefault(); state.settings.fontSize = Math.min(28, state.settings.fontSize + 1); applyEditorSettings(); }
    if ((e.ctrlKey || e.metaKey) && e.key === '-') { e.preventDefault(); state.settings.fontSize = Math.max(9, state.settings.fontSize - 1); applyEditorSettings(); }
  });
}

/* ── public JS API (plugins, console, REST bridge) ───────────── */
function publicAPI() {
  return {
    version: '1.0', pluginAPI, state, commands,
    runCommand, on, emit, toast,
    get files() { return Object.fromEntries(Object.entries(state.files).map(([p, f]) => [p, f.content])); },
    read, write, exists, listFiles, run, analyze: () => runAnalysis(),
    report: () => state.report,
    settings: state.settings,
    project: () => projectJSON(),
    openFile, goto, getDoc, setDoc,
    coverage: () => coverage(),
    srcdoc: () => run('full'),
    console: {
      clear: () => { state.logs = []; renderConsole(); },
      logs: () => state.logs
    }
  };
}

window.addEventListener('error', e => {
  if (e.message?.includes('ResizeObserver')) return;
  console.error('[runlet boot]', e.error || e.message);
});
boot().catch(e => {
  console.error(e);
  document.body.innerHTML = `<div style="padding:40px;font:16px system-ui;color:#fff;background:#111;height:100vh">
    <h1>Runlet: ошибка запуска</h1><pre style="white-space:pre-wrap;color:#ff8">${String(e.stack || e)}</pre>
    <p>Попробуйте перезапустить приложение или сбросить настройки.</p></div>`;
});
