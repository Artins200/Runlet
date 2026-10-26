/* Runlet bootstrap. Works both inside Electron and as a standalone web app. */
import { state, ctx, on, emit, $, $$, toast, debounce, registerCommand, DEFAULT_SETTINGS,
         runCommand, commands, contrastRatio, setFontZoom, toggleWrap } from './core/core.js';
import { initStorage, startAutoSave, persistNow, projectJSON, listFiles, read, write, exists, sanitizeSettings, applySettings } from './core/state.js';
import { initEditors, applyEditorSettings, setPaneFile, goto, getDoc, setDoc, focusPane } from './core/editor.js';
import { initPreview, run, applyDevice, refreshInspectors, send } from './core/preview.js';
import { initFiles, renderTree, openFile, renderLibs, renderAssets } from './core/files.js';
import { initPanels, renderAnalysis, renderConsole, renderDebug } from './core/panels.js';
import { initLearn, renderLearn, initPlugins, renderPlugins, initFeatures, pluginAPI } from './core/extras.js';
import { initCommands } from './core/commands.js';
import { initUI, applyLayout, modal, closeModal, selectInspTab, selectRailTab,
         showStartScreen, showWelcome, hydrateIcons } from './core/ui.js';
import { initProjects, openProject, listProjects } from './core/projects.js';
import { initWindows, toggleWindowedMode, openSiteWindow, openWindow, movePanelWindow,
         detachEditor, windowCount } from './core/windows.js';
import { initThreeD, openThreeDWindow } from './core/threeD.js';
import { initLiveServer, liveStatus, toggleLiveServer } from './core/liveserver.js';
import { srcdoc } from './core/preview.js';
import { runAnalysis, scheduleAnalysis } from './core/analyzer.js';
import { coverage } from './core/data.js';
import { initAppWindow, initMenus, initZoom, refreshZoomLabel, windowControl, isNativeFrame, setAppWindowed } from './core/shellui.js';
import { openThreeStage, threeDStats, threeDRender } from './core/threeD.js';

const started = performance.now();

async function boot() {
  // context API used by modules to avoid circular imports
  Object.assign(ctx, {
    modal, closeModal, runCommand, registerCommand,
    setLayout: applyLayout, applyDevice, openFile, gotoLine: n => goto(state.activePane, n),
    refreshInspectors, selectInspTab, selectRailTab,
    collabSend: (type, data) => collab?.postMessage({ type, data, from: CLIENT_ID, at: Date.now() }),
    renderTree, renderLibs, renderAssets, renderAnalysis, renderConsole, renderDebug,
    applyEditorSettings, focusPane, getDoc, setDoc,
    openProject, listProjects, toggleWindowedMode,
    // new subsystems
    showStartScreen, showWelcome, hydrateIcons,
    applySettings,
    run, analyze: () => runAnalysis(), srcdoc, liveStatus,
    toggleWindows: toggleWindowedMode,
    openSiteWindowRaw: (url, html) => openSiteWindow(url, html),
    openPreviewWindow: () => openWindow({ id: 'preview', title: 'Предпросмотр', icon: 'monitor',
      width: 900, height: 640, html: srcdoc() }),
    openThreeWindow: openThreeStage, openThreeStage,
    movePanelWindow, detachEditor, windowCount,
    setNativeFrame: v => window.runlet?.setFrame?.(v),
    windowControl, isNativeFrame, threeDStats, threeDRender, setAppWindowed,
    toggleLiveServer
  });

  const restored = await initStorage();
  const base = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  const saved = sanitizeSettings(state.settings);
  state.settings = {
    ...base, ...saved,
    sandboxPermissions: { ...base.sandboxPermissions, ...(saved.sandboxPermissions || {}) },
    keybindings: { ...base.keybindings, ...(saved.keybindings || {}) }
  };

  initProjects();
  initEditors();
  initPreview();
  initFiles();
  initPanels();
  initLearn();
  initPlugins();
  initThreeD();
  initWindows();
  initLiveServer();
  initCommands();
  initUI();
  initMenus(); initZoom(); initAppWindow();
  hydrateIcons(); refreshZoomLabel();
  if (window.runlet?.setFrame && !state.settings.nativeFrame) window.runlet.setFrame(false);
  if (state.settings.windowedMode && !state.settings.showLauncher) setTimeout(() => toggleWindowedMode(), 900);

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
      if (chat) {
        const row = document.createElement('div');
        const who = document.createElement('b');
        who.textContent = String(m.data?.name || 'Участник').slice(0, 60) + ': ';
        row.appendChild(who);
        row.appendChild(document.createTextNode(String(m.data?.text || '').slice(0, 500)));
        chat.appendChild(row);
        while (chat.children.length > 200) chat.removeChild(chat.firstChild);
        chat.scrollTop = chat.scrollHeight;
      }
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
    projects: () => listProjects(), openProject, showStartScreen, showWelcome,
    toggleWindowedMode, liveStatus, toggleLiveServer,
    srcdoc: () => srcdoc(),
    scene3d: () => import('./core/threeD.js').then(m => m.getScene()),
    threeD: () => threeDStats(), openThreeD: () => openThreeStage(),
    contrastRatio, setFontZoom, toggleWrap, windowControl,
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
  const box = document.createElement('div');
  box.style.cssText = 'padding:40px;font:16px system-ui;color:#fff;background:#111;height:100vh';
  const h = document.createElement('h1'); h.textContent = 'Runlet: ошибка запуска';
  const pre = document.createElement('pre');
  pre.style.cssText = 'white-space:pre-wrap;color:#ff8';
  pre.textContent = String(e.stack || e).slice(0, 4000);
  const p = document.createElement('p'); p.textContent = 'Попробуйте перезапустить приложение или сбросить настройки.';
  box.append(h, pre, p);
  document.body.replaceChildren(box);
});
