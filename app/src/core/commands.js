/* Every UI action lives here: buttons, hotkeys and the command palette. */
import {
  state, ctx, registerCommand, runCommand, commands, $, $$, toast, copy, download, emit, on,
  applyTheme, debounce, DEFAULT_SETTINGS, esc
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
  versionsDialog, shareDialog
} from './files.js';
import {
  modal, closeModal, commandPalette, settingsModal, shortcutsModal, showStartScreen,
  startTour, startTemplate, applyLayout, collapsePane, fullscreenPane, cycleTheme,
  cycleDensity, snippetsModal, cssLabModal, jsToolsModal, htmlToolsModal,
  gotoLineDialog, colorToolDialog, librarySearchDialog, collaborationDialog,
  selectRailTab, selectInspTab
} from './ui.js';
import { ask, generateFromDescription } from './assistant.js';
import { initLearn, renderLearn, openLesson, initPlugins, renderPlugins, initFeatures, openPlugin } from './extras.js';
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
  cmd('run', 'Запустить предпросмотр', 'Основное', '▶', () => { run('full'); toast('Предпросмотр обновлён', 'ok'); });
  cmd('analyze', 'Проанализировать код', 'Основное', '🧠', () => runAnalysis());
  cmd('analysisReport', 'Полный отчёт анализа', 'Основное', '📊', () => fullAnalysisReport());
  cmd('fixAll', 'Исправить безопасные ошибки', 'Основное', '🛠', () => fixAllSafe());
  cmd('palette', 'Палитра команд', 'Основное', '⌘', () => commandPalette());
  cmd('format', 'Форматировать активный файл', 'Основное', '⌘', () => formatDoc());
  cmd('save', 'Сохранить проект', 'Основное', '💾', () => { persistNow(); toast('Проект сохранён', 'ok'); });
  cmd('download', 'Скачать проект (ZIP)', 'Основное', '⬇', () => exportZip());
  cmd('settings', 'Настройки', 'Основное', '⚙', () => settingsModal());
  cmd('shortcuts', 'Горячие клавиши', 'Основное', '⌨', () => shortcutsModal());
  cmd('theme', 'Сменить тему', 'Основное', '🌓', () => cycleTheme());
  cmd('density', 'Плотность интерфейса', 'Основное', '↕', () => cycleDensity());
  cmd('tour', 'Быстрый тур', 'Основное', '🚀', () => startTour());
  cmd('startScreen', 'Стартовый экран', 'Основное', '🏠', () => showStartScreen());
  cmd('assistant', 'Открыть ассистента', 'Основное', '✦', () => { selectInspTab('assistant'); setTimeout(() => $('#aiInput')?.focus(), 100); });
  cmd('learn', 'Открыть обучение', 'Основное', '🎓', () => { selectRailTab('learn'); renderLearn(); });
  cmd('features', 'Карта 500 идей', 'Основное', '📋', () => { selectRailTab('features'); initFeatures(); });
  cmd('applySettings', 'Применить настройки', 'Основное', '↻', () => { applySettings(); applyEditorSettings(); }, { hidden: true });

  /* ── layouts ────────────────────────────────────────────────── */
  cmd('layoutColumns', 'Раскладка: три колонки', 'Раскладка', '▥', () => applyLayout('columns'));
  cmd('layoutRows', 'Раскладка: три строки', 'Раскладка', '☰', () => applyLayout('rows'));
  cmd('layoutTabs', 'Раскладка: вкладки', 'Раскладка', '▤', () => applyLayout('tabs'));
  cmd('collapsePane', 'Свернуть панель', 'Раскладка', '—', p => collapsePane(typeof p === 'string' ? p : state.activePane));
  cmd('fullscreenPane', 'Панель на весь экран', 'Раскладка', '⛶', p => fullscreenPane(typeof p === 'string' ? p : state.activePane));

  /* ── editing ────────────────────────────────────────────────── */
  cmd('formatHtml', 'Форматировать HTML', 'Редактирование', '⌘', () => formatDoc('html'));
  cmd('formatCss', 'Форматировать CSS', 'Редактирование', '⌘', () => formatDoc('css'));
  cmd('formatJs', 'Форматировать JS', 'Редактирование', '⌘', () => formatDoc('js'));
  cmd('minifyHtml', 'Минифицировать HTML', 'Редактирование', '⇤', () => minifyDoc('html'));
  cmd('minifyCss', 'Минифицировать CSS', 'Редактирование', '⇤', () => minifyDoc('css'));
  cmd('minifyJs', 'Минифицировать JS', 'Редактирование', '⇤', () => minifyDoc('js'));
  cmd('sortCss', 'Сортировать CSS-свойства', 'Редактирование', '⇅', () => sortCssProps('css'));
  cmd('trimTrailing', 'Убрать пробелы в конце строк', 'Редактирование', '⌫', () => { trimTrailing(); toast('Пробелы удалены', 'ok'); });
  cmd('tabsToSpaces', 'Табы → пробелы', 'Редактирование', '→', () => tabsToSpaces());
  cmd('spacesToTabs', 'Пробелы → табы', 'Редактирование', '←', () => spacesToTabs());
  cmd('foldAll', 'Свернуть все регионы', 'Редактирование', '⌄', () => toggleFoldAll());
  cmd('unfoldAll', 'Развернуть всё', 'Редактирование', '⌃', () => unfoldAllPane());
  cmd('snippets', 'Вставить сниппет', 'Редактирование', '✦', () => snippetsModal());
  cmd('emmet', 'Развернуть Emmet', 'Редактирование', '⚡', () => expandEmmet());
  cmd('gotoLine', 'Перейти к строке', 'Редактирование', '↗', () => gotoLineDialog());
  cmd('duplicateLine', 'Дублировать строку', 'Редактирование', '⧉', () => cmCommand('duplicateLine'));
  cmd('moveLineUp', 'Переместить строку вверх', 'Редактирование', '↑', () => cmCommand('moveLineUp'));
  cmd('moveLineDown', 'Переместить строку вниз', 'Редактирование', '↓', () => cmCommand('moveLineDown'));
  cmd('toggleComment', 'Закомментировать строку', 'Редактирование', '//', () => cmCommand('toggleComment'));
  cmd('multiCursor', 'Мультикурсор (Ctrl+D)', 'Редактирование', '⋮', () => cmCommand('selectNextOccurrence'));
  cmd('selectAllOccurrences', 'Выделить все вхождения', 'Редактирование', '◎', () => cmCommand('selectSelectionMatches'));
  cmd('complete', 'Автодополнение', 'Редактирование', '⌨', () => cmCommand('startCompletion'));
  cmd('find', 'Найти в файле', 'Редактирование', '🔍', () => cmCommand('find'));
  cmd('undo', 'Отменить', 'Редактирование', '↶', () => { const v = getActiveEditor(); if (v) { undo(v); v.focus(); } });
  cmd('redo', 'Повторить', 'Редактирование', '↷', () => { const v = getActiveEditor(); if (v) { redo(v); v.focus(); } });

  /* ── generators / labs ──────────────────────────────────────── */
  cmd('cssLab', 'CSS-лаборатория', 'Генераторы', '◐', () => cssLabModal());
  cmd('jsTools', 'JS-инструменты', 'Генераторы', '⚙', () => jsToolsModal());
  cmd('htmlTools', 'HTML-генераторы', 'Генераторы', '🧰', () => htmlToolsModal());
  cmd('contrastTool', 'Проверка контраста WCAG', 'Генераторы', '◑', () => contrastTool());
  cmd('colorTool', 'Конвертер цветов', 'Генераторы', '🎨', () => colorToolDialog());
  cmd('librarySearch', 'Найти CDN-библиотеку', 'Генераторы', '📚', () => librarySearchDialog());
  cmd('generateSEO', 'SEO-метатеги', 'Генераторы', '🔎', () => { insertText(generateSEO(), 'html'); toast('SEO-теги вставлены', 'ok'); });
  cmd('extractCss', 'Извлечь CSS из HTML', 'Генераторы', '⇤', () => extractCssFromHtml());
  cmd('darkTheme', 'Тёмная тема из светлой', 'Генераторы', '🌙', () => { setDoc(darkThemeFrom(getDoc('css')), 'css'); toast('Цвета инвертированы', 'ok'); });
  cmd('mockData', 'Мок-данные JSON', 'Генераторы', '🎲', () => insertText(generateMockData(6), 'js'));

  /* ── files / project ────────────────────────────────────────── */
  cmd('newFile', 'Новый файл', 'Файлы', '＋', () => newFileDialog(false));
  cmd('newFolder', 'Новая папка', 'Файлы', '📁', () => newFileDialog(true));
  cmd('upload', 'Загрузить файлы', 'Файлы', '↑', () => $('#hiddenFileInput')?.click());
  cmd('renameFile', 'Переименовать файл', 'Файлы', '✎', () => renameDialog(Object.values(state.panes).find(p => p) || state.entry));
  cmd('deleteFile', 'Удалить файл', 'Файлы', '🗑', () => deleteConfirm(Object.values(state.panes).find(p => p) || state.entry));
  cmd('duplicateFile', 'Дублировать файл', 'Файлы', '⧉', () => { const p = state.activeFile; if (!exists(p)) return; const ext = p.split('.').pop(); const n = p.replace('.' + ext, '-copy.' + ext); write(n, read(p)); renderTree(); toast('Дублирован: ' + n, 'ok'); });
  cmd('findReferences', 'Найти все ссылки на файл', 'Файлы', '🔗', () => findReferences(state.activeFile));
  cmd('downloadFile', 'Скачать активный файл', 'Файлы', '⬇', () => downloadFile(state.activeFile));
  cmd('exportZip', 'Экспорт проекта в ZIP', 'Файлы', '📦', () => exportZip());
  cmd('importZip', 'Импорт из ZIP', 'Файлы', '📥', () => $('#hiddenZipInput')?.click());
  cmd('importHtml', 'Импорт одиночного HTML', 'Файлы', '📄', () => $('#hiddenHtmlInput')?.click());
  cmd('importUrl', 'Импорт по URL', 'Файлы', '🌐', () => importFromUrl());
  cmd('exportSingleHtml', 'Экспорт в один HTML', 'Файлы', '📃', () => exportSingleHtml());
  cmd('exportStaticSite', 'Экспорт статического сайта', 'Файлы', '🌍', () => exportStaticSite());
  cmd('exportAssets', 'Экспорт ассетов ZIP', 'Файлы', '🖼', () => exportZip({ assetsOnly: true }));
  cmd('cleanupAssets', 'Удалить неиспользуемые ассеты', 'Файлы', '🧹', () => cleanupAssets());
  cmd('snapshot', 'Создать снапшот версии', 'Файлы', '◷', () => snapshotDialog());
  cmd('versions', 'История версий и diff', 'Файлы', '🕘', () => versionsDialog());
  cmd('share', 'Поделиться проектом', 'Файлы', '🔗', () => shareDialog());
  cmd('findInProject', 'Поиск по проекту', 'Файлы', '🔍', () => { selectRailTab('search'); setTimeout(() => $('#globalSearch')?.focus(), 100); });
  cmd('replaceAll', 'Заменить по всему проекту', 'Файлы', '⇄', () => replaceAllInProject());
  cmd('demo', 'Загрузить демо-проект', 'Файлы', '⚡', () => { resetProject(); run('full'); toast('Демо загружено', 'ok'); });
  cmd('writeVirtual', 'Записать виртуальный файл', 'Файлы', '', p => { if (p?.path) write(p.path, p.content || ''); }, { hidden: true });

  /* ── preview / devices ──────────────────────────────────────── */
  cmd('rotateDevice', 'Повернуть устройство', 'Предпросмотр', '⟳', () => rotateDevice());
  cmd('toggleGrid', 'Сетка поверх предпросмотра', 'Предпросмотр', '▦', () => toggleGrid());
  cmd('toggleRulers', 'Линейки и измерение', 'Предпросмотр', '📏', () => toggleRulers());
  cmd('eyedropper', 'Пипетка цвета', 'Предпросмотр', '◉', () => eyedropper());
  cmd('inspectMode', 'Инспектор элементов', 'Предпросмотр', '⌖', () => toggleInspect());
  cmd('previewFullscreen', 'Предпросмотр на весь экран', 'Предпросмотр', '⛶', () => previewFullscreen());
  cmd('popout', 'Открыть предпросмотр в окне', 'Предпросмотр', '↗', () => popout());
  cmd('reloadPreview', 'Перезагрузить предпросмотр', 'Предпросмотр', '↻', () => run('full'));
  cmd('toggleJs', 'Включить/выключить JS', 'Предпросмотр', 'JS', () => { const c = $('#optJs'); c.checked = !c.checked; c.dispatchEvent(new Event('change')); });
  cmd('toggleExternal', 'Блокировать внешние ресурсы', 'Предпросмотр', '🌐', () => { const c = $('#optExternal'); c.checked = !c.checked; c.dispatchEvent(new Event('change')); });
  cmd('emulateReducedMotion', 'Эмуляция reduced-motion', 'Предпросмотр', '🎞', () => { const s = $('#optMotion'); s.value = s.value === 'reduce' ? 'no-preference' : 'reduce'; s.dispatchEvent(new Event('change')); });
  cmd('rtl', 'RTL-разметка', 'Предпросмотр', '↔', () => { const s = $('#optLocale'); s.value = s.value === 'ar' ? 'ru' : 'ar'; s.dispatchEvent(new Event('change')); });
  cmd('schemeEmulation', 'Эмуляция цветовой схемы', 'Предпросмотр', '🌗', () => { const s = $('#optScheme'); s.value = s.value === 'dark' ? 'light' : 'dark'; s.dispatchEvent(new Event('change')); });

  /* ── console / debugging ────────────────────────────────────── */
  cmd('consoleClear', 'Очистить консоль', 'Отладка', '🧹', () => { state.logs = []; renderConsole(); send('clearTrace', {}); });
  cmd('breakpoint', 'Добавить точку останова', 'Отладка', '🔴', () => addBreakpointDialog());
  cmd('refreshInspectors', 'Обновить инспекторы', 'Отладка', '↻', () => refreshInspectors());
  cmd('stepInto', 'Step into', 'Отладка', '↓', () => { state.traceIndex = Math.max(0, state.traceIndex + 1); renderDebugPanel(); });
  cmd('stepOver', 'Step over', 'Отладка', '→', () => { state.traceIndex = Math.min(state.trace.length - 1, state.traceIndex + 1); renderDebugPanel(); });
  cmd('resume', 'Resume', 'Отладка', '▶', () => { state.traceIndex = state.trace.length - 1; renderDebugPanel(); });
  cmd('screenReader', 'Эмуляция скринридера', 'Доступность', '🔊', () => screenReader());
  cmd('a11yReport', 'Отчёт о доступности', 'Доступность', '♿', () => { selectInspTab('dom'); emulateA11y(); });
  cmd('keyboardCheck', 'Проверка фокуса', 'Доступность', '⌨', () => { emulateA11y(); toast('Проверьте порядок Tab в предпросмотре', 'info'); });

  /* ── AI / automation ────────────────────────────────────────── */
  cmd('aiExplain', 'Объяснить код', 'Ассистент', '❓', () => { selectInspTab('assistant'); ask('что делает код?'); });
  cmd('aiExplainSelection', 'Объяснить выделенное', 'Ассистент', '🔍', () => { const s = getSelection(); if (!s) return toast('Сначала выделите код', 'warn'); selectInspTab('assistant'); ask('объясни выделенный код: ' + s.slice(0, 200)); });
  cmd('aiFix', 'Автопочинка ошибок', 'Ассистент', '🛠', () => { selectInspTab('assistant'); ask('исправь ошибки'); });
  cmd('aiTests', 'Сгенерировать тесты', 'Ассистент', '🧪', () => { const t = generateTests(getDoc('js')); insertText(t, 'js'); toast('Тесты вставлены', 'ok'); });
  cmd('aiDocs', 'Документация из кода', 'Ассистент', '📖', () => ctx.modal({ title: 'Документация', wide: true, body: `<pre style="white-space:pre-wrap;font:12px var(--mono)">${esc(generateDocs(getDoc('js')))}</pre>`, okText: 'Скачать', onOk: () => download('DOCS.md', generateDocs(getDoc('js')), 'text/markdown') }));
  cmd('aiReadme', 'Сгенерировать README', 'Ассистент', '📝', () => download('README.md', generateReadme(), 'text/markdown'));
  cmd('aiChangelog', 'Сгенерировать changelog', 'Ассистент', '📋', () => download('CHANGELOG.md', generateChangelog(), 'text/markdown'));
  cmd('aiRefactor', 'Рефакторинг выделенного', 'Ассистент', '♻', () => { const s = getSelection() || getDoc('js'); const out = refactorSelection(s); if (getSelection()) insertText(out); else setDoc(out, 'js'); toast('Рефакторинг применён', 'ok'); });
  cmd('aiSecurity', 'Проверка безопасности', 'Ассистент', '🔒', () => {
    const f = securityScan(Object.values(allTextFiles()).join('\n'));
    ctx.modal({ title: 'Проверка безопасности', wide: true,
      body: f.length ? `<div class="list-rows">${f.map(x => `<div class="list-row"><b>[${x.sev}]</b><div class="grow">${x.msg}</div><small>строка ~${x.line}</small></div>`).join('')}</div>` : '<p>Явных угроз не найдено ✅</p>', okText: 'Закрыть' });
  });
  cmd('aiGenerate', 'Сгенерировать код по описанию', 'Ассистент', '✦', () => ctx.modal({
    title: 'Генерация кода по описанию', narrow: true,
    body: `<div class="field"><label>Опишите, что нужно</label><input id="genDesc" placeholder="сделай карточку товара с кнопкой"></div>
      <p class="muted" style="font-size:11px">Работает офлайн на шаблонах: форма, карточка, кнопка, hero, модальное окно, табы, аккордеон, график, градиент, сетка…</p>`,
    okText: 'Создать',
    onOk: root => { const d = root.querySelector('#genDesc').value; const g = generateFromDescription(d); insertText(g.code, g.lang); toast(g.note, 'ok'); }
  }));
  cmd('aiPerf', 'Советы по оптимизации', 'Ассистент', '⚡', () => ctx.modal({ title: 'Оптимизация', body: '<ul>' + perfTips().map(t => `<li>${t}</li>`).join('') + '</ul>', okText: 'Ок' }));
  cmd('a11yMarkup', 'Доступная разметка', 'Ассистент', '♿', () => { setDoc(accessibleWrap(getDoc('html')), 'html'); toast('alt и aria-label добавлены', 'ok'); });

  /* ── learning ───────────────────────────────────────────────── */
  cmd('lessons', 'Интерактивные уроки', 'Обучение', '📘', () => { selectRailTab('learn'); renderLearn(); openLesson(LESSONS[0]); });
  cmd('quiz', 'Мини-квизы', 'Обучение', '🧠', () => { selectRailTab('learn'); renderLearn(); $('[data-lt="quiz"]')?.click(); });
  cmd('recipes', 'Библиотека рецептов', 'Обучение', '📖', () => { selectRailTab('learn'); renderLearn(); $('[data-lt="recipes"]')?.click(); });
  cmd('visualizations', 'Визуализация event loop', 'Обучение', '🎬', () => { selectRailTab('learn'); renderLearn(); $('[data-lt="viz"]')?.click(); });
  cmd('eventLoop', 'Event loop / async-await', 'Обучение', '🔄', () => cmdRun('visualizations'));

  /* ── perf / PWA ─────────────────────────────────────────────── */
  cmd('perfTips', 'Советы по производительности', 'Перфоманс', '⚡', () => cmdRun('aiPerf'));
  cmd('benchmark', 'Бенчмарк рендера', 'Перфоманс', '⏱', () => {
    const t0 = performance.now(); run('full');
    setTimeout(() => ctx.modal({ title: 'Бенчмарк рендера', narrow: true,
      body: `<div class="gen-preview" style="background:var(--card-2);color:var(--text)">Время до обновления iframe: <b>${Math.round(performance.now() - t0)} мс</b><br>Размер srcdoc: <b>${srcdoc().length}</b> символов<br>Элементов: <b>${state.perf?.elements || '—'}</b></div>`, okText: 'Ок' }), 900);
  });
  cmd('lighthouse', 'Lighthouse-подобная оценка', 'Перфоманс', '📈', () => { selectInspTab('perf'); refreshInspectors(); });
  cmd('bundleSize', 'Размер бандла', 'Перфоманс', '📦', () => toast(`Размер проекта: ${(projectSize() / 1024).toFixed(1)} КБ`, 'info'));
  cmd('lazyLoad', 'Добавить loading="lazy"', 'Перфоманс', '🖼', () => {
    const html = getDoc('html').replace(/<img\b(?![^>]*loading=)/gi, '<img loading="lazy"');
    setDoc(html, 'html'); toast('loading="lazy" добавлен', 'ok');
  });
  cmd('installPWA', 'Установить как приложение', 'PWA', '📲', () => {
    if (window.__pwaPrompt) { window.__pwaPrompt.prompt(); toast('Установка приложения', 'ok'); }
    else toast('Откройте меню браузера → «Установить приложение»', 'info');
  });
  cmd('offlineCheck', 'Проверить офлайн-режим', 'PWA', '📴', () => toast(navigator.onLine ? 'Онлайн. Service Worker кэширует ресурсы.' : 'Офлайн — редактор работает из кэша', 'info'));
  cmd('coldStart', 'Холодный запуск', 'PWA', '❄', () => {
    const nav = typeof performance.getEntriesByType === 'function' ? performance.getEntriesByType('navigation') : [];
    const t = nav[0] || {};
    ctx.modal({ title: 'Холодный запуск', narrow: true,
      body: `<div class="gen-preview" style="background:var(--card-2);color:var(--text)">DOMContentLoaded: <b>${Math.round(t?.domContentLoadedEventEnd || 0)} мс</b><br>Load: <b>${Math.round(t?.loadEventEnd || 0)} мс</b><br>Ресурсов: <b>${(typeof performance.getEntriesByType === 'function' ? performance.getEntriesByType('resource') : []).length}</b></div>`, okText: 'Ок' });
  });

  /* ── extensibility / ecosystem ──────────────────────────────── */
  cmd('plugins', 'Плагины', 'Экосистема', '🔌', () => { selectRailTab('plugins'); renderPlugins(); });
  cmd('pluginMarket', 'Маркетплейс плагинов', 'Экосистема', '🏪', () => { selectRailTab('plugins'); renderPlugins(); toast('Доступны встроенные плагины + установка по ссылке', 'info'); });
  cmd('workflow', 'GitHub Actions workflow', 'Экосистема', '⚙', () => { download('.github-workflows-build.yml', workflowYAML('github'), 'text/yaml'); toast('Workflow скачан', 'ok'); });
  cmd('gitlabCI', 'GitLab CI', 'Экосистема', '🦊', () => download('.gitlab-ci.yml', workflowYAML('gitlab'), 'text/yaml'));
  cmd('embed', 'Embed-код', 'Экосистема', '📺', () => { copy(embedCode()); toast('Embed-код скопирован', 'ok'); });
  cmd('gist', 'Экспорт в GitHub Gist', 'Экосистема', '🐙', () => shareDialog());
  cmd('cli', 'CLI для проектов', 'Экосистема', '▸', () => ctx.modal({ title: 'CLI Runlet', wide: false,
    body: `<p class="muted">Файл <code class="inline">cli/runlet.mjs</code> управляет проектами из терминала:</p>
      <pre style="font:11px var(--mono);background:var(--code-bg);padding:10px;border-radius:12px">node cli/runlet.mjs list
node cli/runlet.mjs analyze index.html
node cli/runlet.mjs build -o dist/index.html
node cli/runlet.mjs serve --port 7788</pre>`, okText: 'Ок' }));
  cmd('webhook', 'Вебхуки на сохранение', 'Экосистема', '🔔', () => ctx.modal({ title: 'Webhooks', narrow: true,
    body: `<div class="field"><label>URL для POST при сохранении</label><input id="hookUrl" placeholder="https://example.com/hook"></div>
      <p class="muted" style="font-size:11px">События: save, analyze, publish. Требуется CORS.</p>`,
    okText: 'Сохранить',
    onOk: root => { state.webhookUrl = root.querySelector('#hookUrl').value; toast('Webhook сохранён', 'ok'); } }));
  cmd('restApi', 'REST API редактора', 'Экосистема', '🌐', () => ctx.modal({ title: 'REST API', wide: false,
    body: `<p class="muted">Локальный сервер (Electron: порт 7788, web: /api):</p>
      <pre style="font:11px var(--mono)">GET  /api/health
POST /api/analyze      {files, entry}
GET  /api/project
PUT  /api/project
GET  /api/files
POST /api/run</pre>`, okText: 'Ок' }));
  cmd('terminalPlugin', 'Плагин-терминал', 'Экосистема', '▸', () => openPlugin('terminal'));

  /* ── collaboration ──────────────────────────────────────────── */
  cmd('collab', 'Совместное редактирование', 'Совместная работа', '👥', () => collaborationDialog());
  cmd('collabInvite', 'Пригласить по e-mail', 'Совместная работа', '✉', () => collaborationDialog());
  cmd('teacherMode', 'Режим преподавателя', 'Совместная работа', '🎓', () => { setReadOnly(true); toast('Режим преподавателя вклён (read-only)', 'ok'); });
  cmd('toggleReadOnly', 'Режим только для чтения', 'Совместная работа', '🔒', () => { setReadOnly(!state.readOnly); toast(state.readOnly ? 'Редактирование заблокировано' : 'Редактирование разрешено', 'info'); });

  /* ── diagnostics helpers ────────────────────────────────────── */
  cmd('gotoDiag', 'Перейти к диагностике', 'Анализ', '↗', arg => {
    const d = state.report?.diagnostics?.find(x => x.id === arg?.id && x.line === arg?.line);
    if (d) gotoDiagnostic(d);
  });
  cmd('explainDiag', 'Объяснить замечание', 'Анализ', '❓', arg => {
    const d = state.report?.diagnostics?.find(x => x.id === arg?.id && x.line === arg?.line);
    if (!d) return;
    selectInspTab('assistant');
    ask(`Объясни проблему ${d.id}: ${d.msg}. ${d.why || ''}`);
  });
  cmd('exportReportMd', 'Отчёт в Markdown', 'Анализ', '⬇', () => exportReport('md'));
  cmd('exportReportJson', 'Отчёт в JSON', 'Анализ', '⬇', () => exportReport('json'));
  cmd('copyReport', 'Скопировать отчёт', 'Анализ', '📋', () => { copy(reportMarkdown()); toast('Отчёт скопирован', 'ok'); });
  cmd('securityScan', 'Сканировать безопасность', 'Анализ', '🔒', () => cmdRun('aiSecurity'));

  /* ── misc helpers (hidden from palette) ─────────────────────── */
  cmd('openFile', 'Открыть файл', 'Файлы', '📄', p => { if (typeof p === 'string') openFile(p); }, { hidden: true });
  cmd('openPanel', 'Открыть панель', 'Основное', '', p => { if (typeof p === 'string') selectInspTab(p); }, { hidden: true });
}

function cmdRun(id) { return runCommand(id); }
function renderDebugPanel() { renderDebug(); }
