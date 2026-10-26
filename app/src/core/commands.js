/* Every UI action lives here: buttons, hotkeys and the command palette. */
import {
  state, ctx, registerCommand, runCommand, commands, $, $$, toast, copy, download, emit, on,
  applyTheme, debounce, DEFAULT_SETTINGS, esc, setFontZoom, toggleWrap, contrastRatio
} from './core.js';
import { undo, redo } from '@codemirror/commands';
import {
  read, write, exists, listFiles, persistNow, makeSnapshot, allTextFiles,
  projectJSON, importProjectJSON, resetProject, resetSettings, exportSettings,
  importSettings, applySettings, applyPreset, projectSize, setReadOnly
} from './state.js';
import {
  setDoc, getDoc, getSelection, insertText, insertSnippet, expandEmmet, formatDoc,
  minifyDoc, sortCssProps, trimTrailing, tabsToSpaces, spacesToTabs, toggleFoldAll,
  unfoldAllPane, cmCommand, goto, focusPane, setPaneFile, applyEditorSettings, getActiveEditor
} from './editor.js';
import { runAnalysis, fixAllSafe, applyFix, gotoDiagnostic, reportMarkdown, reportJSON } from './analyzer.js';
import {
  run, srcdoc, rotateDevice, toggleGrid, toggleRulers, eyedropper, toggleInspect,
  previewFullscreen, popout, refreshInspectors, setBreakpoint, evalInPreview,
  emulateA11y, screenReader, applyDevice, send
} from './preview.js';
import {
  fullAnalysisReport, exportReport, renderConsole, renderDebug, addBreakpointDialog, contrastTool
} from './panels.js';
import {
  newFileDialog, deleteConfirm, renameDialog, openFile, renderTree,
  replaceAllInProject, doSearch, findReferences, downloadFile, exportZip, importZip,
  importSingleHtml, exportSingleHtml, exportStaticSite, importFromUrl, uploadFiles,
  renderLibs, renderAssets, cleanupAssets, showAssetPreview, snapshotDialog,
  versionsDialog, shareDialog, quickCreate, openOSFolder, saveToDisk
} from './files.js';
import {
  modal, closeModal, commandPalette, settingsModal, shortcutsModal, showStartScreen,
  startTour, startTemplate, applyLayout, collapsePane, fullscreenPane, cycleTheme,
  cycleDensity, snippetsModal, cssLabModal, jsToolsModal, htmlToolsModal,
  gotoLineDialog, colorToolDialog, librarySearchDialog, collaborationDialog,
  selectRailTab, selectInspTab
} from './ui.js';
import { startLiveServer, stopLiveServer, toggleLiveServer, openSiteWindow, openSiteExternal, liveServerDialog, liveStatus } from './liveserver.js';
import { toggleWindowedMode, detachEditor, openSiteWindow as openSiteWin, closeAllWindows, windowCount, isWindowed, movePanelWindow } from './windows.js';
import { addObject, exportToProject, openThreeDWindow, getScene, setScene, openThreeStage, threeDStats, threeDRender } from './threeD.js';
import { windowControl, setAppWindowed, refreshZoomLabel } from './shellui.js';
import { makeProject, openProject, exportProject, exportAllProjects, importProjectFile, listProjects } from './projects.js';
import { icon, deEmoji } from './icons.js';
import { initLearn, renderLearn, openLesson, initPlugins, renderPlugins, initFeatures, openPlugin } from './extras.js';
import { showWelcome } from './ui.js';
import {
  generateTests, generateDocs, generateReadme, generateChangelog, generateSEO,
  accessibleWrap, securityScan, perfTips, refactorSelection, extractCssFromHtml,
  darkThemeFrom, workflowYAML, embedCode, staticSite, paletteFrom, generateMockData,
  placeholderImage, faviconFrom, SVG_ICONS, formatJSON, validateJSON
} from './tools.js';
import { LESSONS, QUIZZES, CDN_LIBS, coverage, IMPLEMENTED } from './data.js';

const K = id => state.settings.keybindings[id] || '';
function cmd(id, title, group, icon, fn, opts = {}) {
  registerCommand(id, { title, group, icon, key: K(id), hint: opts.hint, hidden: opts.hidden, run: fn });
}

export function initCommands() {
  /* ── core / UI ──────────────────────────────────────────────── */
  cmd('run', 'Запустить предпросмотр', 'Основное', 'play', () => { run('full'); toast('Предпросмотр обновлён', 'ok'); });
  cmd('analyze', 'Проанализировать код', 'Основное', 'chart', () => runAnalysis());
  cmd('analysisReport', 'Полный отчёт анализа', 'Основное', 'chart', () => fullAnalysisReport());
  cmd('fixAll', 'Исправить безопасные ошибки', 'Основное', 'wand', () => fixAllSafe());
  cmd('palette', 'Палитра команд', 'Основное', 'format', () => commandPalette());
  cmd('format', 'Форматировать активный файл', 'Основное', 'format', () => formatDoc());
  cmd('save', 'Сохранить проект', 'Основное', 'save', () => { persistNow(); toast('Проект сохранён', 'ok'); });
  cmd('download', 'Скачать проект (ZIP)', 'Основное', 'download', () => exportZip());
  cmd('settings', 'Настройки', 'Основное', 'settings', () => settingsModal());
  cmd('shortcuts', 'Горячие клавиши', 'Основное', 'keyboard', () => shortcutsModal());
  cmd('theme', 'Сменить тему', 'Основное', 'theme', () => cycleTheme());
  cmd('density', 'Плотность интерфейса', 'Основное', 'density', () => cycleDensity());
  cmd('tour', 'Быстрый тур', 'Основное', 'help', () => startTour());
  cmd('startScreen', 'Стартовый экран', 'Основное', 'home', () => showStartScreen());
  cmd('learn', 'Открыть обучение', 'Основное', 'book', () => { selectRailTab('learn'); renderLearn(); });
  cmd('features', 'Карта идей', 'Основное', 'list', () => { toast('Вкладка «Идеи» удалена из интерфейса', 'info'); }, { hidden: true });
  cmd('applySettings', 'Применить настройки', 'Основное', 'refresh', () => { applySettings(); applyEditorSettings(); }, { hidden: true });

  /* ── layouts ────────────────────────────────────────────────── */
  cmd('layoutColumns', 'Раскладка: три колонки', 'Раскладка', 'columns', () => applyLayout('columns'));
  cmd('layoutRows', 'Раскладка: три строки', 'Раскладка', 'rows', () => applyLayout('rows'));
  cmd('layoutTabs', 'Раскладка: вкладки', 'Раскладка', 'tabs', () => applyLayout('tabs'));
  cmd('collapsePane', 'Свернуть панель', 'Раскладка', 'minus', p => collapsePane(typeof p === 'string' ? p : state.activePane));
  cmd('fullscreenPane', 'Панель на весь экран', 'Раскладка', 'maximize', p => fullscreenPane(typeof p === 'string' ? p : state.activePane));

  /* ── editing ────────────────────────────────────────────────── */
  cmd('formatHtml', 'Форматировать HTML', 'Редактирование', 'format', () => formatDoc('html'));
  cmd('formatCss', 'Форматировать CSS', 'Редактирование', 'format', () => formatDoc('css'));
  cmd('formatJs', 'Форматировать JS', 'Редактирование', 'format', () => formatDoc('js'));
  cmd('minifyHtml', 'Минифицировать HTML', 'Редактирование', 'indent', () => minifyDoc('html'));
  cmd('minifyCss', 'Минифицировать CSS', 'Редактирование', 'indent', () => minifyDoc('css'));
  cmd('minifyJs', 'Минифицировать JS', 'Редактирование', 'indent', () => minifyDoc('js'));
  cmd('sortCss', 'Сортировать CSS-свойства', 'Редактирование', 'list', () => sortCssProps('css'));
  cmd('trimTrailing', 'Убрать пробелы в конце строк', 'Редактирование', 'scissors', () => { trimTrailing(); toast('Пробелы удалены', 'ok'); });
  cmd('tabsToSpaces', 'Табы → пробелы', 'Редактирование', 'arrowRight', () => tabsToSpaces());
  cmd('spacesToTabs', 'Пробелы → табы', 'Редактирование', 'arrowLeft', () => spacesToTabs());
  cmd('foldAll', 'Свернуть все регионы', 'Редактирование', 'chevronDown', () => toggleFoldAll());
  cmd('unfoldAll', 'Развернуть всё', 'Редактирование', 'chevronUp', () => unfoldAllPane());
  cmd('snippets', 'Вставить сниппет', 'Редактирование', 'brackets', () => snippetsModal());
  cmd('emmet', 'Развернуть Emmet', 'Редактирование', 'wand', () => expandEmmet());
  cmd('gotoLine', 'Перейти к строке', 'Редактирование', 'arrowRight', () => gotoLineDialog());
  cmd('duplicateLine', 'Дублировать строку', 'Редактирование', 'copy', () => cmCommand('duplicateLine'));
  cmd('moveLineUp', 'Переместить строку вверх', 'Редактирование', 'arrowUp', () => cmCommand('moveLineUp'));
  cmd('moveLineDown', 'Переместить строку вниз', 'Редактирование', 'arrowDown', () => cmCommand('moveLineDown'));
  cmd('toggleComment', 'Закомментировать строку', 'Редактирование', 'code', () => cmCommand('toggleComment'));
  cmd('multiCursor', 'Мультикурсор (Ctrl+D)', 'Редактирование', 'chevronRight', () => cmCommand('selectNextOccurrence'));
  cmd('selectAllOccurrences', 'Выделить все вхождения', 'Редактирование', 'chevronRight', () => cmCommand('selectSelectionMatches'));
  cmd('complete', 'Автодополнение', 'Редактирование', 'keyboard', () => cmCommand('startCompletion'));
  cmd('find', 'Найти в файле', 'Редактирование', 'search', () => cmCommand('find'));
  cmd('undo', 'Отменить', 'Редактирование', 'chevronRight', () => { const v = getActiveEditor(); if (v) { undo(v); v.focus(); } });
  cmd('redo', 'Повторить', 'Редактирование', 'chevronRight', () => { const v = getActiveEditor(); if (v) { redo(v); v.focus(); } });

  /* ── generators / labs ──────────────────────────────────────── */
  cmd('cssLab', 'CSS-лаборатория', 'Генераторы', 'palette', () => cssLabModal());
  cmd('jsTools', 'JS-инструменты', 'Генераторы', 'settings', () => jsToolsModal());
  cmd('htmlTools', 'HTML-генераторы', 'Генераторы', 'braces', () => htmlToolsModal());
  cmd('contrastTool', 'Проверка контраста WCAG', 'Генераторы', 'chevronRight', () => contrastTool());
  cmd('colorTool', 'Конвертер цветов', 'Генераторы', 'palette', () => colorToolDialog());
  cmd('librarySearch', 'Найти CDN-библиотеку', 'Генераторы', 'chevronRight', () => librarySearchDialog());
  cmd('generateSEO', 'SEO-метатеги', 'Генераторы', 'chevronRight', () => { insertText(generateSEO(), 'html'); toast('SEO-теги вставлены', 'ok'); });
  cmd('extractCss', 'Извлечь CSS из HTML', 'Генераторы', 'indent', () => extractCssFromHtml());
  cmd('darkTheme', 'Тёмная тема из светлой', 'Генераторы', 'chevronRight', () => { setDoc(darkThemeFrom(getDoc('css')), 'css'); toast('Цвета инвертированы', 'ok'); });
  cmd('mockData', 'Мок-данные JSON', 'Генераторы', 'chevronRight', () => insertText(generateMockData(6), 'js'));

  /* ── files / project ────────────────────────────────────────── */
  cmd('newFile', 'Новый файл', 'Файлы', 'chevronRight', () => newFileDialog(false));
  cmd('newFolder', 'Новая папка', 'Файлы', 'chevronRight', () => newFileDialog(true));
  cmd('upload', 'Загрузить файлы', 'Файлы', 'arrowUp', () => $('#hiddenFileInput')?.click());
  cmd('renameFile', 'Переименовать файл', 'Файлы', 'chevronRight', () => renameDialog(Object.values(state.panes).find(p => p) || state.entry));
  cmd('deleteFile', 'Удалить файл', 'Файлы', 'chevronRight', () => deleteConfirm(Object.values(state.panes).find(p => p) || state.entry));
  cmd('duplicateFile', 'Дублировать файл', 'Файлы', 'copy', () => { const p = state.activeFile; if (!exists(p)) return; const ext = p.split('.').pop(); const n = p.replace('.' + ext, '-copy.' + ext); write(n, read(p)); renderTree(); toast('Дублирован: ' + n, 'ok'); });
  cmd('findReferences', 'Найти все ссылки на файл', 'Файлы', 'link', () => findReferences(state.activeFile));
  cmd('downloadFile', 'Скачать активный файл', 'Файлы', 'download', () => downloadFile(state.activeFile));
  cmd('exportZip', 'Экспорт проекта в ZIP', 'Файлы', 'archive', () => exportZip());
  cmd('importZip', 'Импорт из ZIP', 'Файлы', 'download', () => $('#hiddenZipInput')?.click());
  cmd('importHtml', 'Импорт одиночного HTML', 'Файлы', 'file', () => $('#hiddenHtmlInput')?.click());
  cmd('importUrl', 'Импорт по URL', 'Файлы', 'globe', () => importFromUrl());
  cmd('exportSingleHtml', 'Экспорт в один HTML', 'Файлы', 'chevronRight', () => exportSingleHtml());
  cmd('exportStaticSite', 'Экспорт статического сайта', 'Файлы', 'chevronRight', () => exportStaticSite());
  cmd('exportAssets', 'Экспорт ассетов ZIP', 'Файлы', 'image', () => exportZip({ assetsOnly: true }));
  cmd('cleanupAssets', 'Удалить неиспользуемые ассеты', 'Файлы', 'trash', () => cleanupAssets());
  cmd('snapshot', 'Создать снапшот версии', 'Файлы', 'history', () => snapshotDialog());
  cmd('versions', 'История версий и diff', 'Файлы', 'chevronRight', () => versionsDialog());
  cmd('share', 'Поделиться проектом', 'Файлы', 'link', () => shareDialog());
  cmd('findInProject', 'Поиск по проекту', 'Файлы', 'search', () => { selectRailTab('search'); setTimeout(() => $('#globalSearch')?.focus(), 100); });
  cmd('replaceAll', 'Заменить по всему проекту', 'Файлы', 'resize', () => replaceAllInProject());
  cmd('demo', 'Загрузить демо-проект', 'Файлы', 'wand', () => { resetProject(); run('full'); toast('Демо загружено', 'ok'); });
  cmd('writeVirtual', 'Записать виртуальный файл', 'Файлы', 'chevronRight', p => { if (p?.path) write(p.path, p.content || ''); }, { hidden: true });

  /* ── preview / devices ──────────────────────────────────────── */
  cmd('rotateDevice', 'Повернуть устройство', 'Предпросмотр', 'rotate', () => rotateDevice());
  cmd('toggleGrid', 'Сетка поверх предпросмотра', 'Предпросмотр', 'grid', () => toggleGrid());
  cmd('toggleRulers', 'Линейки и измерение', 'Предпросмотр', 'ruler', () => toggleRulers());
  cmd('eyedropper', 'Пипетка цвета', 'Предпросмотр', 'target', () => eyedropper());
  cmd('inspectMode', 'Инспектор элементов', 'Предпросмотр', 'target', () => toggleInspect());
  cmd('previewFullscreen', 'Предпросмотр на весь экран', 'Предпросмотр', 'maximize', () => previewFullscreen());
  cmd('popout', 'Открыть предпросмотр в окне', 'Предпросмотр', 'arrowRight', () => popout());
  cmd('reloadPreview', 'Перезагрузить предпросмотр', 'Предпросмотр', 'refresh', () => run('full'));
  cmd('toggleJs', 'Включить/выключить JS', 'Предпросмотр', 'chevronRight', () => { const c = $('#optJs'); c.checked = !c.checked; c.dispatchEvent(new Event('change')); });
  cmd('toggleExternal', 'Блокировать внешние ресурсы', 'Предпросмотр', 'globe', () => { const c = $('#optExternal'); c.checked = !c.checked; c.dispatchEvent(new Event('change')); });
  cmd('emulateReducedMotion', 'Эмуляция reduced-motion', 'Предпросмотр', 'chevronRight', () => { const s = $('#optMotion'); if (!s) return; s.value = s.value === 'reduce' ? 'no-preference' : 'reduce'; s.dispatchEvent(new Event('change')); });
  cmd('rtl', 'RTL-разметка', 'Предпросмотр', 'resize', () => { const s = $('#optLocale'); if (!s) return; s.value = s.value === 'ar' ? 'ru' : 'ar'; s.dispatchEvent(new Event('change')); });
  cmd('schemeEmulation', 'Эмуляция цветовой схемы', 'Предпросмотр', 'chevronRight', () => { const s = $('#optScheme'); if (!s) return; s.value = s.value === 'dark' ? 'light' : 'dark'; s.dispatchEvent(new Event('change')); });

  /* ── console / debugging ────────────────────────────────────── */
  cmd('consoleClear', 'Очистить консоль', 'Отладка', 'trash', () => { state.logs = []; renderConsole(); send('clearTrace', {}); });
  cmd('breakpoint', 'Добавить точку останова', 'Отладка', 'chevronRight', () => addBreakpointDialog());
  cmd('refreshInspectors', 'Обновить инспекторы', 'Отладка', 'refresh', () => refreshInspectors());
  cmd('stepInto', 'Step into', 'Отладка', 'arrowDown', () => { state.traceIndex = Math.max(0, state.traceIndex + 1); renderDebugPanel(); });
  cmd('stepOver', 'Step over', 'Отладка', 'arrowRight', () => { state.traceIndex = Math.min(state.trace.length - 1, state.traceIndex + 1); renderDebugPanel(); });
  cmd('resume', 'Resume', 'Отладка', 'play', () => { state.traceIndex = state.trace.length - 1; renderDebugPanel(); });
  cmd('screenReader', 'Эмуляция скринридера', 'Доступность', 'eye', () => screenReader());
  cmd('a11yReport', 'Отчёт о доступности', 'Доступность', 'shield', () => { selectInspTab('dom'); emulateA11y(); });
  cmd('keyboardCheck', 'Проверка фокуса', 'Доступность', 'keyboard', () => { emulateA11y(); toast('Проверьте порядок Tab в предпросмотре', 'info'); });

  /* ── code tools (deterministic, offline) ────────────────────── */
  cmd('codeTests', 'Каркас тестов', 'Инструменты кода', 'chevronRight', () => { insertText(generateTests(getDoc('js')), 'js'); toast('Каркас тестов вставлен', 'ok'); });
  cmd('codeDocs', 'Документация из кода', 'Инструменты кода', 'chevronRight', () => ctx.modal({ title: 'Документация', wide: true,
    body: `<pre style="white-space:pre-wrap;font:12px var(--mono)">${esc(generateDocs(getDoc('js')))}</pre>`,
    okText: 'Скачать', onOk: () => download('DOCS.md', generateDocs(getDoc('js')), 'text/markdown') }));
  cmd('codeReadme', 'README проекта', 'Инструменты кода', 'chevronRight', () => download('README.md', generateReadme(), 'text/markdown'));
  cmd('codeChangelog', 'Changelog', 'Инструменты кода', 'chevronRight', () => download('CHANGELOG.md', generateChangelog(), 'text/markdown'));
  cmd('codeRefactor', 'Простой рефакторинг', 'Инструменты кода', 'chevronRight', () => {
    const s = getSelection() || getDoc('js'), out = refactorSelection(s);
    if (getSelection()) insertText(out); else setDoc(out, 'js');
    toast('var→let, ==→=== применены', 'ok');
  });
  cmd('securityScan', 'Проверка безопасности', 'Инструменты кода', 'chevronRight', () => {
    const f = securityScan(Object.values(allTextFiles()).join('\n'));
    ctx.modal({ title: 'Проверка безопасности', wide: true, okText: 'Закрыть',
      body: f.length ? `<div class="list-rows">${f.map(x => `<div class="list-row"><b>[${x.sev}]</b><div class="grow">${esc(x.msg)}</div><small>строка ~${x.line}</small></div>`).join('')}</div>` : '<p>Явных угроз не найдено.</p>' });
  });
  cmd('codePerf', 'Советы по оптимизации', 'Инструменты кода', 'chevronRight', () => ctx.modal({ title: 'Оптимизация',
    body: '<ul>' + perfTips().map(t => `<li>${esc(t)}</li>`).join('') + '</ul>', okText: 'Ок' }));
  cmd('a11yMarkup', 'Доступная разметка', 'Инструменты кода', 'chevronRight', () => { setDoc(accessibleWrap(getDoc('html')), 'html'); toast('alt и aria-label добавлены', 'ok'); });

  /* ── learning ───────────────────────────────────────────────── */
  cmd('lessons', 'Интерактивные уроки', 'Обучение', 'book', () => { selectRailTab('learn'); renderLearn(); openLesson(LESSONS[0]); });
  cmd('quiz', 'Мини-квизы', 'Обучение', 'chart', () => { selectRailTab('learn'); renderLearn(); $('[data-lt="quiz"]')?.click(); });
  cmd('recipes', 'Библиотека рецептов', 'Обучение', 'book', () => { selectRailTab('learn'); renderLearn(); $('[data-lt="recipes"]')?.click(); });
  cmd('visualizations', 'Визуализация event loop', 'Обучение', 'play', () => { selectRailTab('learn'); renderLearn(); $('[data-lt="viz"]')?.click(); });
  cmd('eventLoop', 'Event loop / async-await', 'Обучение', 'chevronRight', () => cmdRun('visualizations'));

  /* ── perf / PWA ─────────────────────────────────────────────── */
  cmd('perfTips', 'Советы по производительности', 'Перфоманс', 'wand', () => cmdRun('codePerf'));
  cmd('benchmark', 'Бенчмарк рендера', 'Перфоманс', 'chevronRight', () => {
    const t0 = performance.now(); run('full');
    setTimeout(() => ctx.modal({ title: 'Бенчмарк рендера', narrow: true,
      body: `<div class="gen-preview" style="background:var(--card-2);color:var(--text)">Время до обновления iframe: <b>${Math.round(performance.now() - t0)} мс</b><br>Размер srcdoc: <b>${srcdoc().length}</b> символов<br>Элементов: <b>${state.perf?.elements || '—'}</b></div>`, okText: 'Ок' }), 900);
  });
  cmd('lighthouse', 'Lighthouse-подобная оценка', 'Перфоманс', 'chart', () => { selectInspTab('perf'); refreshInspectors(); });
  cmd('bundleSize', 'Размер бандла', 'Перфоманс', 'archive', () => toast(`Размер проекта: ${(projectSize() / 1024).toFixed(1)} КБ`, 'info'));
  cmd('lazyLoad', 'Добавить loading="lazy"', 'Перфоманс', 'image', () => {
    const html = getDoc('html').replace(/<img\b(?![^>]*loading=)/gi, '<img loading="lazy"');
    setDoc(html, 'html'); toast('loading="lazy" добавлен', 'ok');
  });
  cmd('installPWA', 'Установить как приложение', 'PWA', 'window', () => {
    if (window.__pwaPrompt) { window.__pwaPrompt.prompt(); toast('Установка приложения', 'ok'); }
    else toast('Откройте меню браузера → «Установить приложение»', 'info');
  });
  cmd('offlineCheck', 'Проверить офлайн-режим', 'PWA', 'server', () => toast(navigator.onLine ? 'Онлайн. Service Worker кэширует ресурсы.' : 'Офлайн — редактор работает из кэша', 'info'));
  cmd('coldStart', 'Холодный запуск', 'PWA', 'gauge', () => {
    const nav = typeof performance.getEntriesByType === 'function' ? performance.getEntriesByType('navigation') : [];
    const t = nav[0] || {};
    ctx.modal({ title: 'Холодный запуск', narrow: true,
      body: `<div class="gen-preview" style="background:var(--card-2);color:var(--text)">DOMContentLoaded: <b>${Math.round(t?.domContentLoadedEventEnd || 0)} мс</b><br>Load: <b>${Math.round(t?.loadEventEnd || 0)} мс</b><br>Ресурсов: <b>${(typeof performance.getEntriesByType === 'function' ? performance.getEntriesByType('resource') : []).length}</b></div>`, okText: 'Ок' });
  });

  /* ── extensibility / ecosystem ──────────────────────────────── */
  cmd('plugins', 'Плагины', 'Экосистема', 'puzzle', () => { selectRailTab('plugins'); renderPlugins(); });
  cmd('pluginMarket', 'Маркетплейс плагинов', 'Экосистема', 'puzzle', () => { selectRailTab('plugins'); renderPlugins(); toast('Доступны встроенные плагины + установка по ссылке', 'info'); });
  cmd('workflow', 'GitHub Actions workflow', 'Экосистема', 'settings', () => { download('.github-workflows-build.yml', workflowYAML('github'), 'text/yaml'); toast('Workflow скачан', 'ok'); });
  cmd('gitlabCI', 'GitLab CI', 'Экосистема', 'package', () => download('.gitlab-ci.yml', workflowYAML('gitlab'), 'text/yaml'));
  cmd('embed', 'Embed-код', 'Экосистема', 'chevronRight', () => { copy(embedCode()); toast('Embed-код скопирован', 'ok'); });
  cmd('gist', 'Экспорт в GitHub Gist', 'Экосистема', 'package', () => shareDialog());
  cmd('cli', 'CLI для проектов', 'Экосистема', 'terminal', () => ctx.modal({ title: 'CLI Runlet', wide: false,
    body: `<p class="muted">Файл <code class="inline">cli/runlet.mjs</code> управляет проектами из терминала:</p>
      <pre style="font:11px var(--mono);background:var(--code-bg);padding:10px;border-radius:12px">node cli/runlet.mjs list
node cli/runlet.mjs analyze index.html
node cli/runlet.mjs build -o dist/index.html
node cli/runlet.mjs serve --port 7788</pre>`, okText: 'Ок' }));
  cmd('webhook', 'Вебхуки на сохранение', 'Экосистема', 'info', () => ctx.modal({ title: 'Webhooks', narrow: true,
    body: `<div class="field"><label>URL для POST при сохранении</label><input id="hookUrl" placeholder="https://example.com/hook"></div>
      <p class="muted" style="font-size:11px">События: save, analyze, publish. Требуется CORS.</p>`,
    okText: 'Сохранить',
    onOk: root => { state.webhookUrl = root.querySelector('#hookUrl').value; toast('Webhook сохранён', 'ok'); } }));
  cmd('restApi', 'REST API редактора', 'Экосистема', 'globe', () => ctx.modal({ title: 'REST API', wide: false,
    body: `<p class="muted">Локальный сервер (Electron: порт 7788, web: /api):</p>
      <pre style="font:11px var(--mono)">GET  /api/health
POST /api/analyze      {files, entry}
GET  /api/project
PUT  /api/project
GET  /api/files
POST /api/run</pre>`, okText: 'Ок' }));
  cmd('terminalPlugin', 'Плагин-терминал', 'Экосистема', 'terminal', () => openPlugin('terminal'));

  /* ── collaboration ──────────────────────────────────────────── */
  cmd('collab', 'Совместное редактирование', 'Совместная работа', 'users', () => collaborationDialog());
  cmd('collabInvite', 'Пригласить по e-mail', 'Совместная работа', 'link', () => collaborationDialog());
  cmd('teacherMode', 'Режим преподавателя', 'Совместная работа', 'book', () => { setReadOnly(true); toast('Режим преподавателя вклён (read-only)', 'ok'); });
  cmd('toggleReadOnly', 'Режим только для чтения', 'Совместная работа', 'shield', () => { setReadOnly(!state.readOnly); toast(state.readOnly ? 'Редактирование заблокировано' : 'Редактирование разрешено', 'info'); });

  /* ── diagnostics helpers ────────────────────────────────────── */
  cmd('gotoDiag', 'Перейти к диагностике', 'Анализ', 'arrowRight', arg => {
    const d = state.report?.diagnostics?.find(x => x.id === arg?.id && x.line === arg?.line);
    if (d) gotoDiagnostic(d);
  });
  cmd('explainDiag', 'Объяснить замечание', 'Анализ', 'chevronRight', arg => {
    const d = state.report?.diagnostics?.find(x => x.id === arg?.id && x.line === arg?.line);
    if (!d) return;
    ctx.modal({ title: d.id + ' — пояснение', wide: false, okText: 'К строке',
      body: `<p><b>${esc(d.msg)}</b></p>
        ${d.why ? `<div class="beginner">${esc(d.why)}</div>` : ''}
        ${d.fix ? `<p class="muted">Что делать: ${esc(d.fix)}</p>` : ''}
        <p class="muted" style="font-size:11px">${esc(d.file)}:${d.line}</p>`,
      onOk: () => gotoDiagnostic(d) });
  });
  cmd('exportReportMd', 'Отчёт в Markdown', 'Анализ', 'download', () => exportReport('md'));
  cmd('exportReportJson', 'Отчёт в JSON', 'Анализ', 'download', () => exportReport('json'));
  cmd('copyReport', 'Скопировать отчёт', 'Анализ', 'list', () => { copy(reportMarkdown()); toast('Отчёт скопирован', 'ok'); });

  /* ── projects, live server, windows, 3D ─────────────────────── */
  cmd('projectManager', 'Меню проектов', 'Проект', 'folder', () => ctx.showStartScreen?.());
  cmd('exportProject', 'Экспорт проекта', 'Проект', 'archive', () => exportProject(''));
  cmd('exportAllProjects', 'Экспорт всех проектов', 'Проект', 'download', () => exportAllProjects());
  cmd('importProject', 'Импорт проекта', 'Проект', 'upload', () => $('#hiddenProjectInput')?.click());
  cmd('newProject', 'Новый проект', 'Проект', 'plus', () => ctx.showStartScreen?.());
  cmd('liveServer', 'Live Server', 'Сервер', 'server', () => toggleLiveServer());
  cmd('liveServerDialog', 'Настройки Live Server', 'Сервер', 'server', () => liveServerDialog());
  cmd('openSite', 'Сайт в окне', 'Сервер', 'window', () => ctx.openSiteWindow?.());
  cmd('openSiteExternal', 'Открыть сайт в браузере', 'Сервер', 'external', () => openSiteExternal());
  cmd('windowedMode', 'Оконный режим', 'Окна', 'window', () => ctx.toggleWindows?.());
  cmd('closeWindows', 'Закрыть все окна', 'Окна', 'close', () => closeAllWindows());
  cmd('previewWindow', 'Предпросмотр в окне', 'Окна', 'window', () => ctx.openPreviewWindow?.());
  cmd('detachEditor', 'Редактор в окне', 'Окна', 'window', p => detachEditor(typeof p === 'string' ? p : state.activePane));
  cmd('openThreeD', '3D-редактор', '3D', 'cube', () => { selectRailTab('three'); openThreeStage(); });
  cmd('openThreeWindow', '3D в окне', '3D', 'window', () => openThreeStage());
  cmd('openThreeWindow', '3D в окне', '3D', 'window', () => ctx.openThreeWindow?.());
  cmd('threeAdd', 'Добавить объект', '3D', 'plus', () => { selectRailTab('three'); addObject('cube'); });
  cmd('threeExport', 'Экспорт 3D в проект', '3D', 'download', () => exportToProject());
  cmd('helpWelcome', 'Как работать', 'Основное', 'info', () => showWelcome());

  /* ── readable editor, window shell, real files ───────────────── */
  cmd('quickNewHtml', 'Новый HTML-файл', 'Файлы', 'code', () => quickCreate('html'));
  cmd('quickNewCss', 'Новый CSS-файл', 'Файлы', 'palette', () => quickCreate('css'));
  cmd('quickNewJs', 'Новый JS-файл', 'Файлы', 'braces', () => quickCreate('js'));
  cmd('openOSFolder', 'Открыть папку с диска', 'Файлы', 'folder', () => openOSFolder());
  cmd('saveToDisk', 'Сохранить проект на диск', 'Файлы', 'save', () => saveToDisk());
  cmd('fontZoomIn', 'Увеличить шрифт кода', 'Редактор', 'plus', () => { setFontZoom(1); refreshZoomLabel(); });
  cmd('fontZoomOut', 'Уменьшить шрифт кода', 'Редактор', 'minus', () => { setFontZoom(-1); refreshZoomLabel(); });
  cmd('fontZoomReset', 'Сбросить масштаб', 'Редактор', 'refresh', () => { setFontZoom(0, 16); refreshZoomLabel(); });
  cmd('toggleWrap', 'Перенос длинных строк', 'Редактор', 'wrap', () => { toggleWrap(); refreshZoomLabel(); });
  cmd('toggleAnimations', 'Анимации интерфейса', 'Вид', 'spark', () => {
    state.settings.animations = state.settings.animations === false;
    applySettings(); refreshZoomLabel();
    toast(state.settings.animations ? 'Анимации включены' : 'Анимации выключены', 'info');
  });
  cmd('appMinimize', 'Свернуть окно программы', 'Окна', 'minus', () => windowControl('minimize'));
  cmd('appMaximize', 'Развернуть окно программы', 'Окна', 'maximize', () => windowControl('maximize'));
  cmd('appRestore', 'Вернуть окно программы', 'Окна', 'window', () => windowControl('restore'));
  cmd('toggleAppWindow', 'Оконный режим приложения', 'Окна', 'window', () => {
    const v = setAppWindowed(!state.settings.appWindowed);
    toast(v ? 'Оконный режим: можно свернуть и двигать' : 'На весь экран', 'info');
  });
  cmd('contrastCheck', 'Проверка контрастности интерфейса', 'Доступность', 'eye', () => {
    const cs = getComputedStyle(document.documentElement);
    const g = n => cs.getPropertyValue(n).trim();
    const pairs = [
      ['Основной текст', g('--text'), g('--card')],
      ['Второстепенный текст', g('--muted'), g('--card')],
      ['Номера строк / подписи', g('--dim'), g('--code-bg')],
      ['Ошибки', g('--err'), g('--card')],
      ['Предупреждения', g('--warn'), g('--card')],
      ['Успех', g('--ok'), g('--card')]
    ];
    const rows = pairs.map(([name, fg, bg]) => {
      const r = contrastRatio(fg, bg);
      const ok = r >= 4.5;
      return `<div class="list-row"><div class="grow"><b>${esc(name)}</b>
        <small>${esc(fg)} на ${esc(bg)}</small></div>
        <b style="color:${ok ? 'var(--ok)' : 'var(--err)'}">${r.toFixed(2)}:1 ${ok ? 'OK' : 'мало'}</b></div>`;
    }).join('');
    ctx.modal({ title: 'Контрастность интерфейса (WCAG)', wide: false, okText: 'Закрыть',
      body: `<div class="beginner" style="margin:0 0 10px">Норма для обычного текста — не ниже 4.5:1, для крупного и иконок — 3:1.</div>
        <div class="list-rows">${rows}</div>` });
  });

  /* ── misc helpers (hidden from palette) ─────────────────────── */
  cmd('openFile', 'Открыть файл', 'Файлы', 'file', p => { if (typeof p === 'string') openFile(p); }, { hidden: true });
  cmd('openPanel', 'Открыть панель', 'Основное', 'chevronRight', p => { if (typeof p === 'string') selectInspTab(p); }, { hidden: true });
}

function cmdRun(id) { return runCommand(id); }
function renderDebugPanel() { renderDebug(); }
