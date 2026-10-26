/* UI shell: modals, command palette, settings, hotkeys, splitters, tour, labs. */
import {
  state, ctx, commands, registerCommand, runCommand, on, emit, $, $$, el, esc,
  toast, download, copy, debounce, matchKey, keyEventToString, applyTheme,
  applyLocale, fmtBytes, DEFAULT_SETTINGS
} from './core.js';
import {
  applySettings, applyPreset, exportSettings, importSettings, resetSettings,
  persistNow, PRESETS, resetProject, projectJSON, importProjectJSON,
  listFiles, read, write, exists, allTextFiles, setReadOnly
} from './state.js';
import {
  setPaneFile, focusPane, getDoc, setDoc, insertText, insertSnippet, expandEmmet,
  formatDoc, minifyDoc, sortCssProps, trimTrailing, tabsToSpaces, spacesToTabs,
  toggleFoldAll, unfoldAllPane, cmCommand, syncEditorLabels, applyEditorSettings, editors
} from './editor.js';
import { SNIPPETS, CDN_LIBS, LESSONS, coverage } from './data.js';
import { icon, deEmoji } from './icons.js';
import { TEMPLATES, listProjects, makeProject, openProject, renderProjectRows, exportProject, exportAllProjects, importProjectFile } from './projects.js';
import { toggleWindowedMode, isWindowed, closeAllWindows, openWindow, movePanelWindow } from './windows.js';
import {
  generators, convertColor, contrast, contrastVerdict, paletteFrom, hexToRgb,
  specificity, unitConvert, formatJSON, validateJSON, jsonToJS, visualizeJSON,
  generateMockData, uuid, randomColor, generateSEO, generateReadme, generateDocs,
  generateTests, extractCssFromHtml, darkThemeFrom, perfTips, securityScan,
  SVG_ICONS, faviconFrom, placeholderImage
} from './tools.js';

/* Preset commands that may be placed on the quick-action toolbar. */
export const TOOLBAR_PRESETS = [
  { id: 'run', label: 'Запустить', icon: 'play' },
  { id: 'liveServer', label: 'Live Server', icon: 'server' },
  { id: 'openSite', label: 'Сайт в окне', icon: 'window' },
  { id: 'format', label: 'Формат', icon: 'format' },
  { id: 'save', label: 'Сохранить', icon: 'save' },
  { id: 'download', label: 'Скачать ZIP', icon: 'download' },
  { id: 'exportProject', label: 'Экспорт проекта', icon: 'archive' },
  { id: 'importProject', label: 'Импорт проекта', icon: 'upload' },
  { id: 'analyze', label: 'Анализ кода', icon: 'chart' },
  { id: 'snippets', label: 'Сниппеты', icon: 'brackets' },
  { id: 'cssLab', label: 'CSS-лаборатория', icon: 'palette' },
  { id: 'jsTools', label: 'JS-инструменты', icon: 'braces' },
  { id: 'htmlTools', label: 'HTML-генераторы', icon: 'code' },
  { id: 'openThreeD', label: '3D-редактор', icon: 'cube' },
  { id: 'windowedMode', label: 'Оконный режим', icon: 'window' },
  { id: 'tour', label: 'Тур', icon: 'help' },
  { id: 'helpWelcome', label: 'Как работать', icon: 'info' },
  { id: 'learn', label: 'Уроки', icon: 'book' },
  { id: 'shortcuts', label: 'Горячие клавиши', icon: 'keyboard' },
  { id: 'palette', label: 'Команды', icon: 'search' },
  { id: 'theme', label: 'Тема', icon: 'theme' },
  { id: 'settings', label: 'Настройки', icon: 'settings' },
  { id: 'share', label: 'Поделиться', icon: 'link' },
  { id: 'snapshot', label: 'Версия', icon: 'history' }
];
const RAIL_TITLES = {
  files: ['Файлы проекта', 'дерево файлов и папок'], search: ['Поиск', 'по содержимому проекта'],
  libs: ['Библиотеки', 'CDN-зависимости'], assets: ['Ассеты', 'картинки, шрифты, медиа'],
  three: ['3D-редактор', 'примитивы и трансформации'], learn: ['Уроки', 'HTML, CSS и JS'],
  plugins: ['Плагины', 'дополнительные инструменты'], features: ['Карта идей', '500 возможностей']
};
const INSP_TO_SUB = { dom: 'dom', network: 'network', storage: 'storage', perf: 'perf' };

/** Replace <span data-icon="name"> placeholders with real inline SVG. */
export function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach(n => {
    if (n.dataset.iconDone) return;
    n.innerHTML = icon(n.dataset.icon, 16);
    n.dataset.iconDone = '1';
  });
}
/** Rebuild the quick-action toolbar from user settings. */
export function renderToolbar() {
  const primary = $('#toolbarPrimary'), secondary = $('#toolbarSecondary');
  if (!primary || !secondary) return;
  const build = (ids, host, compact) => {
    host.innerHTML = '';
    for (const id of (ids || [])) {
      const c = commands.get(id);
      const preset = TOOLBAR_PRESETS.find(p => p.id === id);
      if (!c) continue;
      const b = document.createElement('button');
      const cls = id === 'run' ? 'btn-run' : (id === 'analyze' ? 'btn-accent' : (compact ? 'btn-ghost' : 'btn'));
      b.className = 'btn ' + cls;
      b.dataset.cmd = id;
      b.title = deEmoji(c.title) + (c.key ? ' · ' + c.key : '');
      b.innerHTML = icon(preset?.icon || c.icon || 'chevronRight', 15) +
        `<span>${esc(preset?.label || deEmoji(c.title))}</span>` + (id === 'analyze' ? '<span class="analyze-badge" id="analyzeBadge">0</span>' : '');
      host.appendChild(b);
    }
  };
  build(state.settings.toolbarButtons, primary, false);
  build(state.settings.toolbarSecondary, secondary, true);
  hydrateIcons(primary); hydrateIcons(secondary);
  const badge = $('#analyzeBadge');
  if (badge && state.report) badge.textContent = (state.report.metrics?.diagnostics?.error || 0) + '';
}

let modalRoot, activeModal = null;
let tourSteps = [], tourIndex = 0;

export function initUI() {
  modalRoot = $('#modalRoot');
  applyTheme(); applyLocale();
  hydrateIcons();
  const pIcon = $('#projectIcon'); if (pIcon) pIcon.innerHTML = icon('folder', 14);
  const palIcon = $('#paletteIcon'); if (palIcon) palIcon.innerHTML = icon('search', 14);
  initTabs(); initSplitters(); initHotkeys(); initWindowControls(); renderToolbar();
  document.addEventListener('click', e => {
    const btn = e.target.closest('[data-cmd]');
    if (!btn) return;
    e.preventDefault();
    const id = btn.dataset.cmd;
    let arg = btn.dataset.arg;
    if (btn.dataset.rid) arg = { id: btn.dataset.rid, line: +btn.dataset.line };
    runCommand(id, arg);
  });
  $('#hiddenProjectInput')?.addEventListener('change', async e => {
    if (e.target.files?.[0]) await importProjectFile(e.target.files[0]);
    e.target.value = '';
  });
  $('#projectName')?.addEventListener('change', e => {
    state.projectName = e.target.value.slice(0, 80);
    emit('project:rename');
  });
  on('toast', d => toast(d.msg, d.type));
  on('project:restoreEditors', syncEditorLabels);
  on('settings:changed', () => {
    $('#optAutoRun') && ($('#optAutoRun').checked = state.settings.autoRun);
    $('#zoomSelect') && ($('#zoomSelect').value = String(state.zoom));
    renderToolbar();
  });
  on('analysis:report', r => { const b = $('#analyzeBadge'); if (b) b.textContent = (r?.metrics?.diagnostics?.error || 0) + ''; });
  on('files:changed', ({ path }) => {
    const pane = Object.entries(state.panes).find(([, p]) => p === path)?.[0];
    if (pane) { const label = $(`[data-pane-file="${pane}"]`); if (label) label.textContent = path; }
  });
  on('windows:changed', () => { for (const v of Object.values(editors)) v.requestMeasure?.(); });
  applyLayout(state.layout);
  // Greeting: welcome first, then the project launcher (never dump the user
  // straight into an anonymous project).
  if (state.settings.showLauncher) setTimeout(() => showStartScreen(), 260);
  else if (!state.settings.welcomeSeen) setTimeout(() => showWelcome(), 350);
}

/* ── tabs ───────────────────────────────────────────────────────── */
function initTabs() {
  $('#railNav')?.addEventListener('click', e => {
    const t = e.target.closest('[data-rail-tab]'); if (!t) return;
    const name = t.dataset.railTab;
    $$('#railNav .nav-item').forEach(x => x.classList.toggle('active', x === t));
    $$('.rail-panel').forEach(x => x.classList.toggle('active', x.dataset.rail === name));
    const meta = RAIL_TITLES[name] || ['', ''];
    const title = $('#railTitle'); if (title) title.textContent = meta[0];
    const hint = $('#railHint'); if (hint) hint.textContent = meta[1];
    emit('rail:tab', name);
    if (name === 'three') emit('three:show');
  });
  $('#inspectorTabs')?.addEventListener('click', e => {
    const t = e.target.closest('[data-insp-tab]'); if (!t) return;
    selectInspTab(t.dataset.inspTab);
  });
  $('#inspectorSubTabs')?.addEventListener('click', e => {
    const t = e.target.closest('[data-sub-tab]'); if (!t) return;
    const name = t.dataset.subTab;
    $$('#inspectorSubTabs .sub-tab').forEach(x => x.classList.toggle('active', x === t));
    $$('.sub-panel').forEach(x => x.classList.toggle('active', x.dataset.sub === name));
    ctx.refreshInspectors?.();
  });
  $('#editors')?.addEventListener('click', e => {
    const t = e.target.closest('[data-pane-tab]'); if (!t) return;
    focusPane(t.dataset.paneTab);
    if (state.layout === 'tabs') applyLayout('tabs', t.dataset.paneTab);
  });
}
export function selectRailTab(name) { $(`#railNav [data-rail-tab="${name}"]`)?.click(); }
export function selectInspTab(name) {
  const sub = INSP_TO_SUB[name];
  const target = sub ? 'inspector' : name;
  const t = $(`[data-insp-tab="${target}"]`);
  if (!t) return;
  $$('.insp-tab').forEach(x => x.classList.toggle('active', x === t));
  $$('.insp-panel').forEach(x => x.classList.toggle('active', x.dataset.insp === target));
  if (sub) {
    $$('.sub-panel').forEach(x => x.classList.toggle('active', x.dataset.sub === sub));
    $$('#inspectorSubTabs .sub-tab').forEach(x => x.classList.toggle('active', x.dataset.subTab === sub));
  }
  emit('insp:tab', target);
  if (['debug', 'dom', 'network', 'storage', 'perf'].includes(name)) ctx.refreshInspectors?.();
}

/* ── splitters ──────────────────────────────────────────────────── */
function initSplitters() {
  $$('.splitter').forEach(sp => {
    sp.addEventListener('pointerdown', e => {
      e.preventDefault(); sp.setPointerCapture(e.pointerId);
      sp.classList.add('dragging'); $('#workspace').classList.add('resizing');
      const kind = sp.dataset.splitter;
      const startX = e.clientX, startY = e.clientY;
      const ws = $('#workspace');
      const railW = parseFloat(getComputedStyle(ws).getPropertyValue('--rail-w')) || 236;
      const dockW = parseFloat(getComputedStyle(ws).getPropertyValue('--dock-w')) || 440;
      const preview = $('#previewCard');
      const startPreviewH = preview.getBoundingClientRect().height;
      const totalH = $('#dock').getBoundingClientRect().height;
      let panes = [], rects = [];
      if (kind === 'e1' || kind === 'e2') {
        const all = $$('.editor-pane');
        panes = kind === 'e1' ? [all[0], all[1]] : [all[1], all[2]];
        rects = panes.map(p => p.getBoundingClientRect());
      }
      const vertical = state.layout === 'rows';
      const onMove = ev => {
        const dx = ev.clientX - startX, dy = ev.clientY - startY;
        if (kind === 'rail') ws.style.setProperty('--rail-w', Math.max(160, Math.min(420, railW + dx)) + 'px');
        else if (kind === 'dock') ws.style.setProperty('--dock-w', Math.max(280, Math.min(760, dockW - dx)) + 'px');
        else if (kind === 'dockH') ws.style.setProperty('--preview-h', Math.max(20, Math.min(85, (startPreviewH + dy) / totalH * 100)) + '%');
        else if (panes.length === 2) {
          const d = vertical ? dy : dx;
          const size0 = vertical ? rects[0].height : rects[0].width;
          const size1 = vertical ? rects[1].height : rects[1].width;
          const a = Math.max(110, size0 + d), b = Math.max(110, size1 - d);
          panes[0].style.flex = `0 0 ${a}px`; panes[1].style.flex = `0 0 ${b}px`;
        }
        ctx.applyDevice?.();
      };
      const onUp = () => {
        sp.classList.remove('dragging'); $('#workspace').classList.remove('resizing');
        window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp);
        for (const v of Object.values(editors)) v.requestMeasure();
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });
  });
}

/* ── layouts / panes ────────────────────────────────────────────── */
export function applyLayout(layout, active = null) {
  state.layout = layout;
  const host = $('#editors');
  host.dataset.layout = layout;
  host.className = 'editors layout-' + layout;
  $$('.layout-group .btn').forEach(b => b.classList.toggle('active',
    (layout === 'columns' && b.dataset.cmd === 'layoutColumns') ||
    (layout === 'rows' && b.dataset.cmd === 'layoutRows') ||
    (layout === 'tabs' && b.dataset.cmd === 'layoutTabs')));
  $$('.editor-pane').forEach((p, i) => {
    p.style.flex = '';
    if (layout === 'tabs') p.classList.toggle('tab-active', p.dataset.pane === (active || state.activePane));
    else p.classList.remove('tab-active');
  });
  if (layout === 'tabs') focusPane(active || state.activePane);
  setTimeout(() => { for (const v of Object.values(editors)) v.requestMeasure(); ctx.applyDevice?.(); }, 60);
}
export function collapsePane(pane) {
  const el = $(`.editor-pane[data-pane="${pane}"]`); if (!el) return;
  state.collapsed[pane] = !state.collapsed[pane];
  el.classList.toggle('collapsed', state.collapsed[pane]);
  setTimeout(() => editors[pane]?.requestMeasure(), 80);
}
export function fullscreenPane(pane) {
  const el = $(`.editor-pane[data-pane="${pane}"]`); if (!el) return;
  el.classList.toggle('maximized');
  setTimeout(() => editors[pane]?.requestMeasure(), 80);
}
export function cycleTheme() {
  const cur = state.settings.theme;
  const next = cur === 'auto' ? 'dark' : cur === 'dark' ? 'light' : cur === 'light' ? 'contrast' : 'auto';
  state.settings.theme = next; applySettings();
  toast('Тема: ' + ({ auto: 'авто', dark: 'тёмная', light: 'светлая', contrast: 'контрастная' })[next], 'info');
}
export function cycleDensity() {
  state.settings.density = state.settings.density === 'comfy' ? 'compact' : 'comfy';
  applySettings(); toast('Плотность: ' + state.settings.density, 'info');
}

/* ── modals ─────────────────────────────────────────────────────── */
export function modal(opts = {}) {
  const { title = '', body = '', okText = 'ОК', cancelText = 'Отмена', onOk, onCancel,
          onMount, danger = false, wide = false, narrow = false, closable = true } = opts;
  closeModal();
  const root = el('div', { class: 'modal ' + (wide ? 'wide ' : '') + (narrow ? 'narrow ' : '') },
    el('div', { class: 'modal-head' },
      el('h2', { text: title }),
      el('button', { class: 'close', text: '×', onclick: () => closeModal() })),
    el('div', { class: 'modal-body', html: body }),
    el('div', { class: 'modal-foot' },
      cancelText ? el('button', { class: 'btn btn-ghost', text: cancelText, onclick: () => { closeModal(); onCancel?.(); } }) : null,
      el('button', { class: 'btn ' + (danger ? '' : 'btn-analyze'), text: okText,
                      style: danger ? { background: 'var(--err)', color: '#fff' } : {},
                      onclick: () => {
                        const r = onOk?.(root);
                        if (r !== false) closeModal();
                      } })));
  root.addEventListener('mousedown', e => { if (e.target === modalRoot) closeModal(); });
  modalRoot.appendChild(root);
  modalRoot.classList.add('show');
  activeModal = root;
  onMount?.(root);
  setTimeout(() => root.querySelector('input,textarea,button')?.focus(), 60);
  return root;
}
export function closeModal() {
  if (modalRoot) { modalRoot.innerHTML = ''; modalRoot.classList.remove('show'); }
  activeModal = null;
}
export function isModalOpen() { return !!activeModal; }

/* ── command palette ────────────────────────────────────────────── */
export function commandPalette() {
  const cmds = [...commands.values()].filter(c => !c.hidden);
  const groups = [...new Set(cmds.map(c => c.group || 'Разное'))];
  modal({
    title: 'Палитра команд', wide: true, cancelText: '', okText: 'Закрыть',
    body: `<input id="paletteInput" placeholder="Команда, файл (#имя), строка (:42)…" autocomplete="off"
        style="width:100%;height:42px;border-radius:14px;border:1px solid var(--border);background:var(--code-bg);padding:0 14px;font-size:14px;outline:0">
      <div class="command-list" id="paletteList" style="margin-top:10px"></div>`,
    onMount: root => {
      const input = root.querySelector('#paletteInput'), list = root.querySelector('#paletteList');
      let items = [], active = 0;
      const draw = q => {
        const ql = q.toLowerCase();
        let pool;
        if (ql.startsWith('#')) {
          const f = ql.slice(1);
          pool = listFiles().filter(p => p.toLowerCase().includes(f)).map(p => ({
            id: 'open:' + p, title: p, group: 'Файлы', icon: 'file', run: () => ctx.openFile(p)
          }));
        } else if (ql.startsWith(':')) {
          const n = +ql.slice(1) || 1;
          pool = [{ id: 'goto', title: `Перейти к строке ${n}`, group: 'Навигация', icon: 'arrowRight', run: () => ctx.gotoLine(n) }];
        } else {
          pool = cmds.filter(c => (c.title + ' ' + (c.group || '') + ' ' + c.id).toLowerCase().includes(ql));
        }
        items = pool.slice(0, 60); active = 0;
        list.innerHTML = '';
        let lastGroup = '';
        items.forEach((c, i) => {
          if (c.group !== lastGroup) { list.appendChild(el('div', { class: 'cmd-group-title', text: c.group || 'Разное' })); lastGroup = c.group; }
          const node = el('div', { class: 'cmd-item ' + (i === 0 ? 'active' : ''), 'data-i': i },
            el('span', { class: 'cmd-ico', html: icon(c.icon || 'chevronRight', 14) }),
            el('div', { class: 'grow' }, el('b', { text: c.title }), c.hint ? el('small', { class: 'dim', text: c.hint }) : null),
            c.key ? el('kbd', { class: 'cmd-key', text: c.key }) : null);
          node.onclick = () => { closeModal(); c.run(); };
          node.onmouseenter = () => { active = i; highlight(); };
          list.appendChild(node);
        });
        if (!items.length) list.appendChild(el('div', { class: 'empty-note', text: 'Ничего не найдено' }));
      };
      const highlight = () => list.querySelectorAll('.cmd-item').forEach((n, i) => n.classList.toggle('active', i === active));
      const execute = () => { const c = items[active]; if (c) { closeModal(); c.run(); } };
      input.addEventListener('input', () => draw(input.value));
      input.addEventListener('keydown', e => {
        if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(items.length - 1, active + 1); highlight(); list.querySelector('.cmd-item.active')?.scrollIntoView({ block: 'nearest' }); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); highlight(); }
        else if (e.key === 'Enter') { e.preventDefault(); execute(); }
      });
      draw('');
    }
  });
}

/* ── settings ───────────────────────────────────────────────────── */
export function settingsModal(tab = 'editor') {
  const s = state.settings;
  const bool = (label, key) => `<label class="chk"><input type="checkbox" data-set="${key}" ${s[key] ? 'checked' : ''}> ${label}</label>`;
  const field = (label, key, type = 'number', extra = '') => `<div class="field"><label>${label}</label>
    <input data-set="${key}" type="${type}" ${type === 'checkbox' ? (s[key] ? 'checked' : '') : `value="${s[key]}"`} ${extra}></div>`;
  const keyRows = () => Object.entries(s.keybindings).map(([id, combo]) => {
    const c = commands.get(id);
    return `<div class="list-row"><div class="grow"><b>${esc(deEmoji(c?.title || id))}</b><small>${esc(id)}</small></div>
      <kbd data-kval="${esc(id)}">${esc(combo)}</kbd>
      <button class="mini-btn" data-rebind="${esc(id)}">Назначить</button>
      <button class="mini-btn" data-checkbind="${esc(id)}">Проверить</button></div>`;
  }).join('');
  const presetOptions = sel => TOOLBAR_PRESETS.map(p => `<option value="${p.id}" ${p.id === sel ? 'selected' : ''}>${esc(p.label)}</option>`).join('');
  const slotRows = (ids, group) => (ids || []).map((id, i) => `<div class="list-row">
      <select class="mini-select" data-slot="${group}" data-i="${i}" style="flex:1">${presetOptions(id)}</select>
      <button class="mini-btn" data-slotup="${group}" data-i="${i}">${icon('arrowUp', 12)}</button>
      <button class="mini-btn" data-slotdown="${group}" data-i="${i}">${icon('arrowDown', 12)}</button>
      <button class="mini-btn" data-slotdel="${group}" data-i="${i}">${icon('trash', 12)}</button></div>`).join('');
  const pages = {
    editor: `<div class="field-row">
        ${field('Размер шрифта', 'fontSize', 'number', 'min="9" max="28"')}
        ${field('Межстрочный интервал', 'lineHeight', 'number', 'step="0.1" min="1" max="2.5"')}
        ${field('Ширина табуляции', 'tabSize', 'number', 'min="1" max="8"')}
        <div class="field"><label>Шрифт редактора</label><select data-set="fontFamily">
          ${['mono', 'system', 'courier', 'sans'].map(v => `<option value="${v}" ${s.fontFamily === v ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
      </div>
      <h4 style="margin:10px 0 5px;font-size:11px">Отображение</h4>
      <div class="rowflex">${bool('Пробелы и табы', 'showWhitespace')}${bool('Невидимые символы', 'showInvisibles')}
        ${bool('Перенос строк', 'wrap')}${bool('Мини-карта', 'minimap')}${bool('Хлебные крошки', 'breadcrumbs')}
        ${bool('Плавная прокрутка', 'smoothScroll')}${bool('Убирать пробелы в конце', 'trimTrailingWhitespace')}</div>
      <h4 style="margin:12px 0 5px;font-size:11px">Пресеты</h4>
      <div class="tabs-line">${Object.entries(PRESETS).map(([k, v]) => `<button data-preset="${k}" class="${s.presets === k ? 'active' : ''}">${v.label}</button>`).join('')}</div>`,
    preview: `<div class="field-row">
        ${field('Задержка автозапуска (мс)', 'autoRunDelay', 'number', 'min="100" max="5000"')}
        ${field('Задержка анализа (мс)', 'autoAnalyzeDelay', 'number', 'min="300" max="10000"')}
        ${field('Автосохранение (сек)', 'autoSaveInterval', 'number', 'min="5" max="300"')}
      </div><div class="rowflex">${bool('Автозапуск', 'autoRun')}${bool('Автоанализ', 'autoAnalyze')}
        ${bool('Автосохранение', 'autoSave')}${bool('CSS hot swap', 'hotCss')}${bool('JS hot reload', 'hotJs')}
        ${bool('Подтверждать удаление', 'confirmDelete')}</div>
      <h4 style="margin:12px 0 5px;font-size:11px">Разрешения sandbox</h4>
      <p class="muted" style="font-size:10.5px;margin:0 0 6px">Включайте только для доверенных проектов.</p>
      <div class="rowflex">${[['forms', 'Формы'], ['popups', 'Новые окна'], ['modals', 'Модальные окна'], ['downloads', 'Скачивания'], ['pointerLock', 'Pointer lock'], ['orientationLock', 'Ориентация']].map(([k, l]) =>
        `<label class="chk"><input type="checkbox" data-sandbox="${k}" ${s.sandboxPermissions?.[k] ? 'checked' : ''}> ${l}</label>`).join('')}</div>`,
    keys: `<div class="beginner" style="margin:0 0 10px">Здесь можно переназначить и проверить сочетания.
      Нажмите «Назначить», затем нужные клавиши. «Проверить» покажет, сработает ли выбранный бинд.</div>
      <div class="list-rows" id="keyRows">${keyRows()}</div>
      <div class="rowflex mt8"><button class="mini-btn" id="keysReset">Сбросить бинды</button>
        <span class="muted" style="font-size:10.5px">Всего комбинаций: ${Object.keys(s.keybindings).length}</span></div>`,
    buttons: `<div class="beginner" style="margin:0 0 10px">Кнопки верхней панели выбираются из готового набора.
      Меняйте команду в строке, порядок — стрелками, лишние — удаляйте.</div>
      <h4 style="margin:0 0 5px;font-size:11px">Основная панель</h4>
      <div class="list-rows" id="tbPrimary">${slotRows(s.toolbarButtons, 'primary')}</div>
      <div class="rowflex mt8"><select class="mini-select" id="tbAddPrimary" style="flex:1">${presetOptions('')}</select>
        <button class="mini-btn" id="tbAddPrimaryBtn">Добавить</button></div>
      <h4 style="margin:14px 0 5px;font-size:11px">Дополнительная панель</h4>
      <div class="list-rows" id="tbSecondary">${slotRows(s.toolbarSecondary, 'secondary')}</div>
      <div class="rowflex mt8"><select class="mini-select" id="tbAddSecondary" style="flex:1">${presetOptions('')}</select>
        <button class="mini-btn" id="tbAddSecondaryBtn">Добавить</button>
        <button class="mini-btn" id="tbReset">Сбросить набор</button></div>`,
    windows: `<div class="list-rows">
        <div class="list-row"><div class="grow"><b>Оконный режим</b><small>Сайт, 3D и консоль в плавающих окнах</small></div>
          <button class="mini-btn ${isWindowed() ? 'active' : ''}" id="wndToggle">${isWindowed() ? 'Выключить' : 'Включить'}</button></div>
        <div class="list-row"><div class="grow"><b>Системная рамка окна</b><small>Только Electron; приложение перезапустит окно</small></div>
          <button class="mini-btn ${s.nativeFrame ? 'active' : ''}" id="wndFrame">${s.nativeFrame ? 'Вкл' : 'Выкл'}</button></div>
        <div class="list-row"><div class="grow"><b>Меню проектов при запуске</b><small>Встречать список проектов, а не пустой редактор</small></div>
          <label class="chk"><input type="checkbox" data-set="showLauncher" ${s.showLauncher ? 'checked' : ''}> показывать</label></div>
      </div>
      <div class="field-row mt8">${field('Порт Live Server', 'livePort', 'number', 'min="1024" max="65535"')}</div>
      <div class="rowflex mt8"><button class="mini-btn" id="wndSite">Сайт в окне</button>
        <button class="mini-btn" id="wndThree">3D в окне</button>
        <button class="mini-btn" id="wndCloseAll">Закрыть все окна</button>
        <button class="mini-btn" id="wndWelcome">Показать приветствие</button></div>`,
    theme: `<div class="field-row">
        <div class="field"><label>Тема</label><select data-set="theme">
          ${['auto', 'dark', 'light', 'contrast'].map(v => `<option value="${v}" ${s.theme === v ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
        ${field('Акцентный цвет', 'accent', 'color')}
        <div class="field"><label>Плотность</label><select data-set="density">
          <option value="comfy" ${s.density === 'comfy' ? 'selected' : ''}>просторно</option>
          <option value="compact" ${s.density === 'compact' ? 'selected' : ''}>компактно</option></select></div>
      </div><div class="gen-preview" style="background:var(--accent);color:var(--accent-ink);border:0">Так выглядит акцент интерфейса</div>
      <div class="beginner">Плоские поверхности, без неоновых свечений и градиентных кнопок. Цвет меняется мгновенно.</div>`,
    storage: `<div class="list-rows">
        <div class="list-row"><div class="grow"><b>Размер проекта</b><small>${fmtBytes(Object.values(state.files).reduce((n, f) => n + f.content.length, 0))}</small></div></div>
        <div class="list-row"><div class="grow"><b>Файлов</b><small>${listFiles().length}</small></div></div>
        <div class="list-row"><div class="grow"><b>Проектов в меню</b><small>${listProjects().length}</small></div></div></div>
      <div class="tabs-line mt8"><button id="setExport">Экспорт настроек</button><button id="setImport">Импорт настроек</button>
        <button id="setReset">Сброс настроек</button><button id="setSave">Сохранить сейчас</button></div>`,
    about: `<div style="display:flex;gap:12px;align-items:center;padding:6px 0 14px">
        <div class="brand-mark" style="width:44px;height:44px;border-radius:12px">${icon('code', 24)}</div>
        <div><h2 style="margin:0;font-size:16px">Runlet Studio 2.0</h2>
        <p class="muted" style="margin:3px 0 0;font-size:11px">Редактор сайтов: HTML, CSS, JS, 3D и локальный Live Server.</p></div></div>
      <div class="list-rows"><div class="list-row"><b>Анализ</b><div class="grow" style="text-align:right">${esc(state.engine)}</div></div>
        <div class="list-row"><b>Окон</b><div class="grow" style="text-align:right">${ctx.windowCount?.() ?? 0}</div></div>
        <div class="list-row"><b>Платформа</b><div class="grow" style="text-align:right">${window.runlet?.platform || navigator.platform}</div></div></div>
      <p class="muted mt8" style="font-size:11px">Python 3 (stdlib), CodeMirror 6, esbuild, Electron. Иконки — встроенный SVG-набор.</p>`
  };
  const tabs = { editor: 'Редактор', preview: 'Предпросмотр', keys: 'Бинды', buttons: 'Кнопки', windows: 'Окна', theme: 'Вид', storage: 'Хранилище', about: 'О программе' };
  modal({ title: 'Настройки Runlet', wide: true, okText: 'Готово',
    body: `<div class="tabs-line" id="setTabs">${Object.entries(tabs).map(([k, v]) => `<button data-st="${k}" class="${k === tab ? 'active' : ''}">${v}</button>`).join('')}</div><div id="setBody">${pages[tab] || pages.editor}</div>`,
    onMount: root => {
      const body = root.querySelector('#setBody');
      const captureKey = cb => {
        const h = e => {
          e.preventDefault(); e.stopImmediatePropagation();
          window.removeEventListener('keydown', h, true);
          cb(e);
        };
        window.addEventListener('keydown', h, true);
      };
      const mount = t => {
        body.innerHTML = pages[t] || pages.editor;
        body.querySelectorAll('[data-set]').forEach(inp => inp.addEventListener('change', () => {
          const k = inp.dataset.set;
          const v = inp.type === 'checkbox' ? inp.checked : (inp.type === 'number' ? +inp.value : inp.value);
          state.settings[k] = v; applySettings();
        }));
        body.querySelectorAll('[data-sandbox]').forEach(inp => inp.addEventListener('change', () => {
          state.settings.sandboxPermissions = { ...(state.settings.sandboxPermissions || {}), [inp.dataset.sandbox]: inp.checked };
          applySettings();
        }));
        body.querySelectorAll('[data-preset]').forEach(b => b.onclick = () => { applyPreset(b.dataset.preset); closeModal(); settingsModal(t); });
        // ── key bindings: reassign + check, right here in settings ──
        body.querySelectorAll('[data-rebind]').forEach(b => b.onclick = () => {
          const id = b.dataset.rebind, old = b.textContent;
          b.textContent = 'Нажмите клавиши…'; b.classList.add('active');
          captureKey(e => {
            if (e.key === 'Escape') { b.textContent = old; b.classList.remove('active'); return; }
            const combo = keyEventToString(e);
            state.settings.keybindings[id] = combo;
            applySettings(); toast(`${deEmoji(commandTitle(id))}: ${combo}`, 'ok');
            b.textContent = old; b.classList.remove('active');
            const k = body.querySelector(`[data-kval="${id}"]`); if (k) k.textContent = combo;
          });
        });
        body.querySelectorAll('[data-checkbind]').forEach(b => b.onclick = () => {
          const id = b.dataset.checkbind;
          const expected = state.settings.keybindings[id];
          const box = document.createElement('div');
          box.style.cssText = 'position:fixed;z-index:4000;left:50%;top:50%;transform:translate(-50%,-50%);background:var(--card-solid);border:1px solid var(--accent);border-radius:12px;padding:18px 24px;box-shadow:var(--shadow);text-align:center;font:13px var(--sans);color:var(--text)';
          box.innerHTML = `<b>Проверка бинда</b><p style="color:var(--muted);font-size:11px;margin:8px 0">Нажмите <kbd>${esc(expected)}</kbd></p><div id="kcRes" class="muted">Ожидание…</div>`;
          document.body.appendChild(box);
          captureKey(e => {
            const got = keyEventToString(e);
            const res = box.querySelector('#kcRes');
            const okk = got === expected;
            res.textContent = okk ? 'Совпадает — бинд работает' : `Вы нажали ${got}, ожидалось ${expected}`;
            res.style.color = okk ? 'var(--ok)' : 'var(--err)';
            setTimeout(() => box.remove(), 1600);
          });
        });
        body.querySelector('#keysReset')?.addEventListener('click', () => {
          state.settings.keybindings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS.keybindings));
          applySettings(); closeModal(); settingsModal('keys');
          toast('Бинды сброшены', 'ok');
        });
        // ── toolbar slots ──
        const keyOf = g => g === 'primary' ? 'toolbarButtons' : 'toolbarSecondary';
        const rerender = () => { closeModal(); settingsModal('buttons'); };
        body.querySelectorAll('[data-slot]').forEach(sel => sel.addEventListener('change', () => {
          const g = sel.dataset.slot, arr = [...(state.settings[keyOf(g)] || [])];
          arr[+sel.dataset.i] = sel.value; state.settings[keyOf(g)] = arr;
          applySettings(); renderToolbar(); toast('Кнопка заменена', 'ok');
        }));
        const move = (g, i, d) => {
          const arr = [...(state.settings[keyOf(g)] || [])];
          const j = i + d; if (j < 0 || j >= arr.length) return;
          [arr[i], arr[j]] = [arr[j], arr[i]]; state.settings[keyOf(g)] = arr;
          applySettings(); renderToolbar(); rerender();
        };
        body.querySelectorAll('[data-slotup]').forEach(b => b.onclick = () => move(b.dataset.slotup, +b.dataset.i, -1));
        body.querySelectorAll('[data-slotdown]').forEach(b => b.onclick = () => move(b.dataset.slotdown, +b.dataset.i, 1));
        body.querySelectorAll('[data-slotdel]').forEach(b => b.onclick = () => {
          const g = b.dataset.slotdel, arr = [...(state.settings[keyOf(g)] || [])];
          arr.splice(+b.dataset.i, 1); state.settings[keyOf(g)] = arr;
          applySettings(); renderToolbar(); rerender();
        });
        for (const [selId, btnId, group] of [['#tbAddPrimary', '#tbAddPrimaryBtn', 'primary'], ['#tbAddSecondary', '#tbAddSecondaryBtn', 'secondary']]) {
          body.querySelector(btnId)?.addEventListener('click', () => {
            const id = body.querySelector(selId).value;
            const arr = [...(state.settings[keyOf(group)] || []), id].slice(0, 14);
            state.settings[keyOf(group)] = arr; applySettings(); renderToolbar(); rerender();
          });
        }
        body.querySelector('#tbReset')?.addEventListener('click', () => {
          state.settings.toolbarButtons = [...DEFAULT_SETTINGS.toolbarButtons];
          state.settings.toolbarSecondary = [...DEFAULT_SETTINGS.toolbarSecondary];
          applySettings(); renderToolbar(); rerender();
        });
        // ── windows ──
        body.querySelector('#wndToggle')?.addEventListener('click', () => { ctx.toggleWindows?.(); closeModal(); });
        body.querySelector('#wndFrame')?.addEventListener('click', () => {
          state.settings.nativeFrame = !state.settings.nativeFrame;
          applySettings(); ctx.setNativeFrame?.(state.settings.nativeFrame); closeModal();
        });
        body.querySelector('#wndSite')?.addEventListener('click', () => ctx.openSiteWindow?.());
        body.querySelector('#wndThree')?.addEventListener('click', () => ctx.openThreeWindow?.());
        body.querySelector('#wndCloseAll')?.addEventListener('click', () => closeAllWindows());
        body.querySelector('#wndWelcome')?.addEventListener('click', () => { closeModal(); showWelcome(); });
        body.querySelector('#setExport')?.addEventListener('click', () => download('runlet-settings.json', exportSettings(), 'application/json'));
        body.querySelector('#setImport')?.addEventListener('click', () => {
          const i = document.createElement('input'); i.type = 'file'; i.accept = '.json';
          i.onchange = async () => { try { importSettings(await i.files[0].text()); closeModal(); settingsModal(t); } catch (e) { toast(e.message, 'err'); } };
          i.click();
        });
        body.querySelector('#setReset')?.addEventListener('click', () => { resetSettings(); closeModal(); settingsModal(t); });
        body.querySelector('#setSave')?.addEventListener('click', () => { persistNow(); toast('Сохранено', 'ok'); });
      };
      mount(tab);
      root.querySelectorAll('[data-st]').forEach(b => b.onclick = () => {
        root.querySelectorAll('[data-st]').forEach(x => x.classList.remove('active')); b.classList.add('active'); mount(b.dataset.st);
      });
    } });
}
function commandTitle(id) {
  return commands.get(id)?.title || id;
}

/* ── hotkeys ────────────────────────────────────────────────────── */
function initHotkeys() {
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (isModalOpen()) { closeModal(); return; }
      if ($('#tourLayer')?.classList.contains('show')) { endTour(); return; }
      if ($('.editor-pane.maximized')) { $('.editor-pane.maximized').classList.remove('maximized'); return; }
      if ($('#previewCard')?.classList.contains('preview-max')) { $('#previewCard').classList.remove('preview-max'); return; }
    }
    for (const [id, combo] of Object.entries(state.settings.keybindings)) {
      if (!combo) continue;
      if (matchKey(e, combo)) {
        e.preventDefault(); e.stopPropagation();
        runCommand(id);
        return;
      }
    }
  }, true);
}
export function shortcutsModal() {
  const rows = Object.entries(state.settings.keybindings).map(([k, v]) =>
    `<div class="kv"><span>${esc(deEmoji(commandTitle(k)))}</span><b><kbd>${esc(v)}</kbd></b></div>`).join('');
  modal({ title: 'Горячие клавиши', narrow: true, okText: 'Настроить',
    body: `<div class="debug-steps">${rows}</div>
      <p class="muted mt8" style="font-size:11px">Переназначить и проверить бинды можно в Настройки → Бинды.
      В редакторе также работают Ctrl+F, Ctrl+Z/Y, Ctrl+D, Alt+клик.</p>`,
    onOk: () => { setTimeout(() => settingsModal('keys'), 80); } });
}

/* ── window controls (Electron) ─────────────────────────────────── */
function initWindowControls() {
  if (!window.runlet?.isElectron) return;
  const host = $('#winControls');
  for (const [label, act] of [['—', 'minimize'], ['□', 'maximize'], ['×', 'close']]) {
    host.appendChild(el('button', { class: act === 'close' ? 'wc-close' : '', text: label,
      onclick: () => window.runlet.windowControl(act) }));
  }
  $('#titlebar')?.classList.add('electron');
}

/* ── greeting / project launcher ─────────────────────────────────── */
export function showWelcome() {
  const cards = [
    ['code', 'Три панели', 'HTML, CSS и JS рядом. Пишете код — он сразу сохраняется в проекте.'],
    ['monitor', 'Предпросмотр', 'Справа результат: десктоп, планшет или телефон, плюс окно сайта.'],
    ['chart', 'Анализ кода', 'Python-движок объясняет, что делает код, и подсвечивает ошибки.'],
    ['server', 'Live Server', 'Запускает сайт по настоящему адресу с автообновлением страницы.'],
    ['cube', '3D-редактор', 'Ставьте куб, сферу или тор, меняйте размер и экспортируйте сцену.'],
    ['window', 'Оконный режим', 'Любую панель можно вынести в отдельное плавающее окно.']
  ];
  modal({ title: 'Добро пожаловать в Runlet', wide: true, okText: 'Понятно',
    body: `<p class="muted" style="font-size:12px;margin:0 0 14px">Коротко о том, как здесь всё устроено.</p>
      <div class="welcome-grid">${cards.map(([i, t, d]) => `<div class="welcome-card">${icon(i, 20)}<b>${t}</b><span>${d}</span></div>`).join('')}</div>
      <div class="beginner mt8">Совет: Ctrl+Shift+P открывает палитру команд, Ctrl+Enter — запуск предпросмотра,
      Ctrl+Shift+A — анализ кода. Все сочетания меняются в настройках.</div>
      <div class="rowflex mt8"><button class="mini-btn" id="wcTour">Показать тур по интерфейсу</button>
        <button class="mini-btn" id="wcProjects">Открыть меню проектов</button></div>`,
    onMount: root => {
      root.querySelector('#wcTour').onclick = () => { closeModal(); startTour(); };
      root.querySelector('#wcProjects').onclick = () => { closeModal(); showStartScreen(); };
    },
    onOk: () => { state.settings.welcomeSeen = true; applySettings(); } });
}
export function showStartScreen() {
  const screen = $('#startScreen');
  const steps = [
    ['code', 'Пишите код', 'HTML, CSS и JS в трёх панелях.'],
    ['monitor', 'Смотрите результат', 'Предпросмотр или отдельное окно сайта.'],
    ['chart', 'Проверяйте', 'Анализ объяснит код и найдёт ошибки.'],
    ['archive', 'Сохраняйте', 'Проекты экспортируются и импортируются.']
  ];
  let chosen = 'starter';
  screen.innerHTML = `<div class="launch">
    <div class="launch-side">
      <div class="launch-logo"><div class="brand-mark">${icon('code', 22)}</div><div><b>Runlet</b><br><span>studio 2.0</span></div></div>
      <h1 class="launch-title">Редактор сайтов,<br>в котором всё понятно.</h1>
      <p class="launch-lead">Проекты, живой предпросмотр, локальный сервер, 3D и анализ кода — в одном окне без лишнего шума.</p>
      <div class="launch-steps">${steps.map(([i, t, d]) => `<div class="launch-step"><div class="launch-step-i">${icon(i, 16)}</div>
        <div><b>${t}</b><span>${d}</span></div></div>`).join('')}</div>
      <div class="launch-foot"><button class="btn btn-ghost" id="launchWelcome">Как работать</button>
        <button class="btn btn-ghost" id="launchTour">Тур</button></div>
    </div>
    <div class="launch-main">
      <div class="launch-head"><div><h2>Проекты</h2><p>Создайте новый или откройте существующий.</p></div>
        <button class="mini-btn" id="launchImportAll">${icon('upload', 13)} Импорт</button></div>
      <div class="launch-create">
        <input id="prjName" placeholder="Название проекта" maxlength="80" value="Новый сайт">
        <select id="prjTemplate">${TEMPLATES.map(t => `<option value="${t.id}" ${t.id === chosen ? 'selected' : ''}>${t.name}</option>`).join('')}</select>
        <button class="btn btn-accent" id="prjCreate">${icon('plus', 15)} Создать</button>
      </div>
      <div class="template-grid" id="prjTemplates">${TEMPLATES.map(t => `<div class="template-card ${t.id === chosen ? 'active' : ''}" data-tpl="${t.id}">${icon(t.icon, 17)}<b>${t.name}</b><small>${t.desc}</small></div>`).join('')}</div>
      <div class="launch-head"><div><h2 style="font-size:13px">Мои проекты</h2></div>
        <div class="rowflex"><button class="mini-btn" id="prjExportAll">${icon('download', 13)} Экспорт всех</button>
          <button class="mini-btn" id="prjExport">${icon('archive', 13)} Экспорт</button></div></div>
      <div class="launch-projects" id="prjList"></div>
      <div class="rowflex mt8" style="justify-content:flex-end">
        <label class="chk"><input type="checkbox" id="prjShow" ${state.settings.showLauncher ? 'checked' : ''}> показывать это меню при запуске</label>
        <button class="btn btn-ghost" id="prjDirect">Открыть редактор</button></div>
    </div>
  </div>`;
  screen.classList.add('show');
  const list = screen.querySelector('#prjList');
  const open = id => {
    state.settings.showLauncher = screen.querySelector('#prjShow').checked;
    applySettings(); openProject(id); screen.classList.remove('show');
    if (!state.settings.welcomeSeen) setTimeout(showWelcome, 350);
  };
  renderProjectRows(list, open);
  screen.querySelectorAll('[data-tpl]').forEach(c => c.onclick = () => {
    chosen = c.dataset.tpl;
    screen.querySelectorAll('[data-tpl]').forEach(x => x.classList.toggle('active', x === c));
    screen.querySelector('#prjTemplate').value = chosen;
  });
  screen.querySelector('#prjTemplate').onchange = e => {
    chosen = e.target.value;
    screen.querySelectorAll('[data-tpl]').forEach(x => x.classList.toggle('active', x.dataset.tpl === chosen));
  };
  const create = () => {
    const name = screen.querySelector('#prjName').value.trim() || 'Новый проект';
    const rec = makeProject(name, chosen);
    open(rec.id);
    toast('Проект создан: ' + rec.name, 'ok');
  };
  screen.querySelector('#prjCreate').onclick = create;
  screen.querySelector('#prjName').addEventListener('keydown', e => { if (e.key === 'Enter') create(); });
  screen.querySelector('#launchImportAll').onclick = () => $('#hiddenProjectInput')?.click();
  screen.querySelector('#prjExportAll').onclick = () => exportAllProjects();
  screen.querySelector('#prjExport').onclick = () => exportProject('');
  screen.querySelector('#launchWelcome').onclick = () => showWelcome();
  screen.querySelector('#launchTour').onclick = () => { screen.classList.remove('show'); startTour(); };
  screen.querySelector('#prjDirect').onclick = () => {
    state.settings.showLauncher = screen.querySelector('#prjShow').checked;
    applySettings();
    const projects = listProjects();
    if (projects.length) openProject(projects[0].id);
    screen.classList.remove('show');
    if (!state.settings.welcomeSeen) setTimeout(showWelcome, 300);
  };
  if (!screen.dataset.projectsWired) {
    screen.dataset.projectsWired = '1';
    on('projects:changed', () => { if (screen.classList.contains('show') && list.isConnected) renderProjectRows(list, open); });
  }
}
export function startTemplate(id) {
  const name = 'Проект ' + new Date().toLocaleDateString('ru-RU');
  const rec = makeProject(name, TEMPLATES.some(t => t.id === id) ? id : 'blank');
  openProject(rec.id);
  toast('Проект создан: ' + rec.name, 'ok');
}

const TOUR = [
  { sel: '.brand-mark', title: 'Runlet Studio', text: 'Редактор сайтов на Electron. Проекты сохраняются автоматически.' },
  { sel: '.editor-pane[data-pane="html"]', title: 'Три панели кода', text: 'HTML, CSS и JS рядом. Разделители тянутся мышью, панели сворачиваются и открываются в окнах.' },
  { sel: '#deviceSwitch', title: 'Предпросмотр', text: 'Десктоп, планшет или телефон. Справа — Live Server, который запускает сайт по настоящему адресу.' },
  { sel: '#inspectorTabs', title: 'Анализ и консоль', text: 'Python-движок объясняет код и ошибки; рядом консоль, отладчик и инспектор.' },
  { sel: '#railNav', title: 'Проект и инструменты', text: 'Файлы, поиск, библиотеки, ассеты, 3D-редактор и уроки — всё сгруппировано.' },
  { sel: '#toolbarPrimary', title: 'Свои кнопки', text: 'Панель действий настраивается в Настройки → Кнопки: выберите нужные команды из списка.' }
];
export function startTour() { tourIndex = 0; tourSteps = TOUR; $('#tourLayer').classList.add('show'); drawTour(); }
export function endTour() { $('#tourLayer').classList.remove('show'); $('#tourLayer').innerHTML = ''; }
function drawTour() {
  const layer = $('#tourLayer');
  const step = tourSteps[tourIndex];
  if (!step) { endTour(); return; }
  const target = $(step.sel);
  const r = target?.getBoundingClientRect() || { left: innerWidth / 2 - 100, top: innerHeight / 2 - 60, width: 200, height: 120 };
  layer.innerHTML = `<div class="tour-spot" style="left:${r.left - 6}px;top:${r.top - 6}px;width:${r.width + 12}px;height:${r.height + 12}px"></div>
    <div class="tour-box" style="left:${Math.min(innerWidth - 320, Math.max(12, r.left))}px;top:${Math.min(innerHeight - 180, r.bottom + 16)}px">
      <h4>${esc(step.title)}</h4><p>${esc(step.text)}</p>
      <div class="tour-nav"><button class="mini-btn" id="tourPrev">←</button>
        <button class="mini-btn" id="tourNext">${tourIndex === tourSteps.length - 1 ? 'Готово' : 'Далее →'}</button>
        <button class="mini-btn" id="tourSkip">Пропустить</button>
        <span class="tour-step">${tourIndex + 1}/${tourSteps.length}</span></div></div>`;
  layer.querySelector('#tourPrev').onclick = () => { tourIndex = Math.max(0, tourIndex - 1); drawTour(); };
  layer.querySelector('#tourNext').onclick = () => { tourIndex++; if (tourIndex >= tourSteps.length) endTour(); else drawTour(); };
  layer.querySelector('#tourSkip').onclick = endTour;
}

/* ── snippet / generator labs ───────────────────────────────────── */
export function snippetsModal(cat = state.activePane) {
  const list = SNIPPETS.filter(s => s.cat === cat).concat(state.userSnippets.filter(s => s.cat === cat));
  modal({ title: `Сниппеты · ${cat.toUpperCase()}`, wide: true, okText: 'Закрыть',
    body: `<div class="tabs-line" id="snipCats">${['html', 'css', 'js'].map(c => `<button data-c="${c}" class="${c === cat ? 'active' : ''}">${c.toUpperCase()}</button>`).join('')}
      <button id="newSnippet">＋ Свой сниппет</button></div>
      <div class="grid-cards" id="snipList">${list.map((s, i) => `<div class="tile" data-snip="${i}"><b>${esc(s.name)}</b><small>${esc(s.desc)}</small>
        <pre style="font:10px var(--mono);max-height:70px;overflow:hidden;opacity:.6;margin-top:6px">${esc(s.code.slice(0, 140))}</pre></div>`).join('')}</div>`,
    onMount: root => {
      root.querySelectorAll('[data-c]').forEach(b => b.onclick = () => { closeModal(); snippetsModal(b.dataset.c); });
      root.querySelectorAll('[data-snip]').forEach(t => t.onclick = () => {
        insertSnippet(list[+t.dataset.snip].code, cat); closeModal(); toast('Сниппет вставлен', 'ok');
      });
      root.querySelector('#newSnippet').onclick = () => {
        closeModal();
        modal({ title: 'Новый сниппет', wide: true,
          body: `<div class="field-row"><div class="field"><label>Название</label><input id="usName" value="Мой сниппет"></div>
            <div class="field"><label>Язык</label><select id="usCat"><option>html</option><option>css</option><option>js</option></select></div></div>
            <div class="field"><label>Код (плейсхолдеры \${1:текст})</label><textarea id="usCode" rows="8" style="font:12px var(--mono)"></textarea></div>
            <p class="muted" style="font-size:11px">\${1} … \${0} — позиции табуляции после вставки.</p>`,
          okText: 'Сохранить',
          onOk: r => {
            state.userSnippets.push({ id: 'u' + Date.now(), name: r.querySelector('#usName').value,
              cat: r.querySelector('#usCat').value, desc: 'пользовательский', code: r.querySelector('#usCode').value });
            toast('Сниппет сохранён', 'ok');
          } });
      };
    } });
}
export function htmlToolsModal() {
  const gens = [
    ['HTML5-скелет', () => SNIPPETS.find(s => s.id === 'html5').code],
    ['SEO-метатеги', () => generateSEO()],
    ['Schema.org', () => SNIPPETS.find(s => s.id === 'schema').code],
    ['Preload', () => SNIPPETS.find(s => s.id === 'preload').code],
    ['Доступная разметка', () => SNIPPETS.find(s => s.id === 'a11y').code],
    ['Favicon', () => `<link rel="icon" href="favicon.png">`],
    ['SVG-иконки', () => Object.values(SVG_ICONS).join('\n')]
  ];
  modal({ title: 'HTML-инструменты', wide: true, okText: 'Закрыть',
    body: `<div class="grid-cards" id="htmlGens">${gens.map(([n, f], i) => `<div class="tile" data-hg="${i}"><div class="tile-ico"></div><b>${n}</b><small>Вставить в HTML</small></div>`).join('')}</div>
      <div class="field mt8"><label>Результат</label><textarea id="htmlGenOut" rows="8" style="font:11px var(--mono)"></textarea></div>
      <div class="rowflex"><button class="mini-btn" id="htmlGenInsert">Вставить в HTML</button><button class="mini-btn" id="htmlGenCopy">Копировать</button></div>`,
    onMount: root => {
      root.querySelectorAll('[data-hg]').forEach(t => t.onclick = () => {
        const code = gens[+t.dataset.hg][1]();
        root.querySelector('#htmlGenOut').value = code;
        if (gens[+t.dataset.hg][0] === 'Favicon') write('favicon.png', faviconFrom(state.settings.accent));
      });
      root.querySelector('#htmlGenInsert').onclick = () => { insertText(root.querySelector('#htmlGenOut').value, 'html'); closeModal(); };
      root.querySelector('#htmlGenCopy').onclick = () => copy(root.querySelector('#htmlGenOut').value);
    } });
}
export function cssLabModal() {
  const g = generators;
  const defs = [
    { id: 'gradient', name: 'Градиент', controls: [['a', 'color', '#7c6cf6'], ['b', 'color', '#b06cf6'], ['angle', 'range', 135], ['type', 'select', ['linear', 'radial']]], fn: v => g.gradient(v.a, v.b, v.angle, v.type) },
    { id: 'shadow', name: 'Box-shadow', controls: [['y', 'range', 12], ['blur', 'range', 30], ['alpha', 'range', 25], ['inset', 'check', false]], fn: v => g.boxShadow(0, v.y, v.blur, 0, '#000000', v.alpha / 100, v.inset) },
    { id: 'textShadow', name: 'Text-shadow', controls: [['y', 'range', 2], ['blur', 'range', 8]], fn: v => g.textShadow(0, v.y, v.blur, '#00000066') },
    { id: 'radius', name: 'Border-radius', controls: [['tl', 'range', 18], ['tr', 'range', 18], ['br', 'range', 18], ['bl', 'range', 18]], fn: v => g.radius(v.tl, v.tr, v.br, v.bl) },
    { id: 'transform', name: 'Transform', controls: [['scale', 'range', 100], ['rotate', 'range', 0], ['tx', 'range', 0]], fn: v => g.transform(v.scale / 100, v.rotate, v.tx, 0) },
    { id: 'transition', name: 'Transition', controls: [['prop', 'text', 'all'], ['dur', 'range', 3]], fn: v => g.transition(v.prop, v.dur / 10, 'ease', 0) },
    { id: 'animation', name: 'Animation + keyframes', controls: [['name', 'text', 'pop'], ['dur', 'range', 6]], fn: v => g.animation(v.name, v.dur / 10, 1) },
    { id: 'filter', name: 'Filter', controls: [['blur', 'range', 0], ['brightness', 'range', 100], ['grayscale', 'range', 0]], fn: v => g.filter(v.blur, v.brightness, 100, v.grayscale, 0) },
    { id: 'backdrop', name: 'Backdrop-filter', controls: [['blur', 'range', 12]], fn: v => g.backdrop(v.blur, 140) },
    { id: 'clip', name: 'Clip-path', controls: [['shape', 'select', ['circle', 'ellipse', 'polygon', 'inset', 'triangle']], ['v', 'range', 50]], fn: v => g.clipPath(v.shape, v.v) },
    { id: 'grid', name: 'Grid', controls: [['cols', 'range', 3], ['gap', 'range', 16]], fn: v => g.grid(v.cols, v.gap) },
    { id: 'flex', name: 'Flexbox', controls: [['dir', 'select', ['row', 'column']], ['justify', 'select', ['center', 'flex-start', 'space-between']], ['gap', 'range', 12]], fn: v => g.flex(v.dir, v.justify, 'center', v.gap) },
    { id: 'vars', name: 'CSS-переменные', controls: [['base', 'color', '#7c6cf6']], fn: v => g.variables(v.base) },
    { id: 'fontface', name: '@font-face', controls: [['name', 'text', 'MyFont'], ['path', 'text', 'fonts/myfont.woff2']], fn: v => g.fontFace(v.name, v.path) }
  ];
  modal({ title: 'CSS-лаборатория', wide: true, okText: 'Вставить CSS',
    body: `<div class="tabs-line" id="cssGenTabs">${defs.map((d, i) => `<button data-g="${i}" class="${i === 0 ? 'active' : ''}">${d.name}</button>`).join('')}</div>
      <div class="field-row" id="cssControls"></div>
      <div class="gen-preview" id="cssPreview" style="background:linear-gradient(135deg,#7c6cf6,#b06cf6)">Пример</div>
      <div class="field"><label>CSS</label><textarea id="cssOut" rows="6" style="font:12px var(--mono)"></textarea></div>
      <div class="rowflex"><button class="mini-btn" id="cssCopy">Копировать</button><button class="mini-btn" id="cssPrefix">＋ Автопрефиксы</button>
        <button class="mini-btn" id="cssContrast">Контраст</button><button class="mini-btn" id="cssExtract">Извлечь CSS из HTML</button>
        <button class="mini-btn" id="cssDark">Тёмная тема из светлой</button></div>
      <div id="cssExtra" class="mt8"></div>`,
    onOk: root => { insertText(root.querySelector('#cssOut').value, 'css'); },
    onMount: root => {
      let cur = 0;
      const render = () => {
        const d = defs[cur];
        const values = {};
        root.querySelector('#cssControls').innerHTML = d.controls.map(([k, type, def]) => {
          values[k] = def;
          if (type === 'select') return `<div class="field"><label>${k}</label><select data-v="${k}">${def.map(x => `<option value="${x}">${x}</option>`).join('')}</select></div>`;
          if (type === 'check') return `<label class="chk"><input type="checkbox" data-v="${k}"> ${k}</label>`;
          if (type === 'color') return `<div class="field"><label>${k}</label><input type="color" data-v="${k}" value="${def}"></div>`;
          if (type === 'text') return `<div class="field"><label>${k}</label><input data-v="${k}" value="${def}"></div>`;
          return `<div class="field"><label>${k}: <span data-label="${k}">${def}</span></label><input type="range" data-v="${k}" min="0" max="360" value="${def}"></div>`;
        }).join('');
        const update = () => {
          root.querySelectorAll('[data-v]').forEach(inp => {
            const k = inp.dataset.v;
            values[k] = inp.type === 'checkbox' ? inp.checked : inp.type === 'range' ? +inp.value : inp.value;
            const lb = root.querySelector(`[data-label="${k}"]`); if (lb) lb.textContent = values[k];
          });
          const css = d.fn(values);
          root.querySelector('#cssOut').value = css;
          root.querySelector('#cssPreview').style.cssText = css.replace(/@[\s\S]*/, '') + ';height:100px;border-radius:12px';
        };
        root.querySelectorAll('[data-v]').forEach(i => i.addEventListener('input', update));
        update();
      };
      root.querySelectorAll('[data-g]').forEach(b => b.onclick = () => {
        root.querySelectorAll('[data-g]').forEach(x => x.classList.remove('active')); b.classList.add('active');
        cur = +b.dataset.g; render();
      });
      root.querySelector('#cssCopy').onclick = () => copy(root.querySelector('#cssOut').value);
      root.querySelector('#cssPrefix').onclick = () => { root.querySelector('#cssOut').value = g.autoprefix(root.querySelector('#cssOut').value); };
      root.querySelector('#cssContrast').onclick = () => ctx.runCommand('contrastTool');
      root.querySelector('#cssExtract').onclick = () => { const c = extractCssFromHtml(); if (c) root.querySelector('#cssExtra').textContent = `Извлечено ${c.length} символов в extracted.css`; };
      root.querySelector('#cssDark').onclick = () => { root.querySelector('#cssOut').value = darkThemeFrom(getDoc('css')); };
      render();
    } });
}
export function jsToolsModal() {
  modal({ title: 'JS-инструменты', wide: true, okText: 'Закрыть',
    body: `<div class="tabs-line" id="jsToolTabs"><button class="active" data-jt="json">JSON</button>
      <button data-jt="gen">Генераторы</button><button data-jt="check">Проверки</button><button data-jt="convert">Конвертация</button></div>
      <div id="jsToolBody"></div>`,
    onMount: root => {
      const box = root.querySelector('#jsToolBody');
      const pages = {
        json: `<div class="field"><label>JSON / код</label><textarea id="jsIn" rows="8" style="font:12px var(--mono)">${esc(getDoc('js').slice(0, 1200))}</textarea></div>
          <div class="rowflex"><button class="mini-btn" data-j="format">Форматировать</button><button class="mini-btn" data-j="validate">Валидировать</button>
            <button class="mini-btn" data-j="tojs">JSON → JS</button><button class="mini-btn" data-j="viz">Визуализировать</button>
            <button class="mini-btn" data-j="mock">Мок-данные</button><button class="mini-btn" data-j="uuid">UUID</button></div>
          <pre id="jsOut" style="font:11px var(--mono);background:var(--code-bg);padding:10px;border-radius:12px;margin-top:10px;max-height:220px;overflow:auto"></pre>`,
        gen: `<div class="grid-cards">${[['Тесты', 'tests'], ['Документация', 'docs'], ['README', 'readme'], ['Changelog', 'changelog'], ['Мок-данные', 'mock'], ['Случайный цвет', 'color']].map(([n, k]) =>
          `<div class="tile" data-gen="${k}"><b>${n}</b><small>Сгенерировать</small></div>`).join('')}</div><pre id="jsOut" style="font:11px var(--mono);background:var(--code-bg);padding:10px;border-radius:12px;margin-top:10px;max-height:260px;overflow:auto"></pre>`,
        check: `<div class="rowflex"><button class="mini-btn" data-j="security">Безопасность</button>
          <button class="mini-btn" data-j="perf">Перфоманс</button><button class="mini-btn" data-j="syntax">Синтаксис</button></div>
          <div id="jsOut" class="mt8"></div>`,
        convert: `<div class="field-row"><div class="field"><label>Значение</label><input id="cvVal" value="16"></div>
          <div class="field"><label>Из</label><select id="cvFrom"><option>px</option><option>rem</option><option>%</option></select></div>
          <div class="field"><label>В</label><select id="cvTo"><option>rem</option><option>px</option><option>%</option></select></div></div>
          <div id="jsOut" class="gen-preview" style="background:var(--card-2);color:var(--text)"></div>
          <div class="field mt8"><label>Цвет</label><input id="cvColor" value="#7c6cf6"></div><div id="colorOut" class="mt8"></div>`
      };
      const mount = t => {
        box.innerHTML = pages[t];
        if (t === 'json') box.querySelectorAll('[data-j]').forEach(b => b.onclick = () => {
          const inp = box.querySelector('#jsIn').value, out = box.querySelector('#jsOut');
          const map = { format: () => formatJSON(inp), validate: () => JSON.stringify(validateJSON(inp), null, 2),
            tojs: () => jsonToJS(inp), viz: () => visualizeJSON(inp), mock: () => generateMockData(6), uuid: () => uuid() };
          out.textContent = map[b.dataset.j]?.() || '';
        });
        if (t === 'gen') box.querySelectorAll('[data-gen]').forEach(b => b.onclick = () => {
          const code = getDoc('js');
          const map = { tests: () => generateTests(code), docs: () => generateDocs(code), readme: () => generateReadme(),
            changelog: () => generateChangelog(), mock: () => generateMockData(6), color: () => randomColor() };
          box.querySelector('#jsOut').textContent = map[b.dataset.gen]();
        });
        if (t === 'check') box.querySelectorAll('[data-j]').forEach(b => b.onclick = () => {
          const code = Object.values(allTextFiles()).join('\n'), out = box.querySelector('#jsOut');
          if (b.dataset.j === 'security') out.innerHTML = '<div class="list-rows">' + securityScan(code).map(f => `<div class="list-row"><b>[${f.sev}]</b><div class="grow">${esc(f.msg)}</div></div>`).join('') + '</div>';
          if (b.dataset.j === 'perf') out.innerHTML = '<ul>' + perfTips().map(x => `<li>${esc(x)}</li>`).join('') + '</ul>';
          if (b.dataset.j === 'syntax') { out.textContent = 'Синтаксис проверяется движком: Ctrl+Shift+A'; runAnalysis(); }
        });
        if (t === 'convert') {
          const upd = () => {
            box.querySelector('#jsOut').textContent = '= ' + unitConvert(box.querySelector('#cvVal').value, box.querySelector('#cvFrom').value, box.querySelector('#cvTo').value);
            const c = convertColor(box.querySelector('#cvColor').value);
            box.querySelector('#colorOut').innerHTML = c ? `<div class="debug-steps">${Object.entries(c).map(([k, v]) => `<div class="kv"><span>${k}</span><b>${esc(v)}</b></div>`).join('')}</div>` : '<span class="muted">Не распознано</span>';
          };
          box.querySelectorAll('input,select').forEach(i => i.addEventListener('input', upd)); upd();
        }
      };
      root.querySelectorAll('[data-jt]').forEach(b => b.onclick = () => {
        root.querySelectorAll('[data-jt]').forEach(x => x.classList.remove('active')); b.classList.add('active'); mount(b.dataset.jt);
      });
      mount('json');
    } });
}

/* ── misc dialogs ───────────────────────────────────────────────── */
export function gotoLineDialog() {
  modal({ title: 'Перейти к строке', narrow: true,
    body: `<div class="field"><label>Номер строки</label><input id="gotoLine" type="number" value="1" min="1"></div>`,
    okText: 'Перейти',
    onOk: root => ctx.gotoLine(+root.querySelector('#gotoLine').value || 1) });
}
export function colorToolDialog() {
  modal({ title: 'Цвет и контраст', narrow: true,
    body: `<div class="field"><label>Цвет</label><input type="color" id="ctColor" value="#7c6cf6"></div>
      <div id="ctOut" class="debug-steps"></div><div id="ctPalette" class="rowflex mt8"></div>`,
    okText: 'Вставить HEX',
    onOk: root => insertText(root.querySelector('#ctColor').value),
    onMount: root => {
      const upd = () => {
        const c = convertColor(root.querySelector('#ctColor').value);
        root.querySelector('#ctOut').innerHTML = c ? Object.entries(c).map(([k, v]) => `<div class="kv"><span>${k}</span><b>${esc(v)}</b></div>`).join('') : '';
        root.querySelector('#ctPalette').innerHTML = paletteFrom(root.querySelector('#ctColor').value, 7).map(x => `<button class="mini-btn" style="background:${x};color:#fff" data-c="${x}">${x}</button>`).join('');
        root.querySelectorAll('[data-c]').forEach(b => b.onclick = () => { root.querySelector('#ctColor').value = b.dataset.c; upd(); });
      };
      root.querySelector('#ctColor').addEventListener('input', upd); upd();
    } });
}
export function librarySearchDialog() {
  modal({ title: 'Библиотеки и CDN', wide: true, okText: 'Закрыть',
    body: `<input id="libSearch2" placeholder="Поиск: tailwind, chart, react…" style="width:100%;height:34px;border-radius:11px;border:1px solid var(--border);background:var(--code-bg);padding:0 12px;margin-bottom:10px">
      <div class="list-rows" id="libSearchRows"></div>`,
    onMount: root => {
      const rows = root.querySelector('#libSearchRows');
      const draw = q => {
        rows.innerHTML = '';
        for (const l of CDN_LIBS.filter(x => (x.name + x.desc + x.cat).toLowerCase().includes(q.toLowerCase()))) {
          const row = el('div', { class: 'list-row' },
            el('div', { class: 'grow' }, el('b', { text: l.name }), el('small', { text: l.desc + ' · ' + l.cat })),
            el('button', { class: 'mini-btn', text: state.deps.some(d => (typeof d === 'string' ? d : d.id) === l.id) ? '' : '+' }));
          row.querySelector('button').onclick = () => {
            state.deps.push({ id: l.id, version: l.versions[0], name: l.name, enabled: true });
            emit('deps:changed'); toast('Подключено: ' + l.name, 'ok'); draw(q);
          };
          rows.appendChild(row);
        }
      };
      draw(''); root.querySelector('#libSearch2').addEventListener('input', e => draw(e.target.value));
    } });
}
export function collaborationDialog() {
  modal({ title: 'Совместная работа', wide: false, okText: 'Закрыть',
    body: `<div class="beginner">Синхронизация между вкладками одного браузера через BroadcastChannel: изменения файлов, чат и курсоры видны всем открытым окнам Runlet.</div>
      <div class="mt8"><b>Участники:</b> <span id="collabPeers">только вы</span></div>
      <div class="field mt8"><label>Чат</label><div id="collabChat" style="height:140px;overflow:auto;background:var(--code-bg);border-radius:12px;padding:8px;font-size:11px"></div></div>
      <div class="repl-bar"><input id="collabMsg" placeholder="Сообщение…"><button class="mini-btn" id="collabSend">Отправить</button></div>
      <div class="tabs-line mt8"><button id="collabInvite">Пригласить по e-mail</button><button id="collabTeacher">Режим преподавателя</button></div>`,
    onMount: root => {
      const chat = root.querySelector('#collabChat');
      const send = () => {
        const v = root.querySelector('#collabMsg').value.trim(); if (!v) return;
        ctx.collabSend?.('chat', { text: v, name: 'Вы' });
        root.querySelector('#collabMsg').value = '';
      };
      root.querySelector('#collabSend').onclick = send;
      root.querySelector('#collabMsg').addEventListener('keydown', e => { if (e.key === 'Enter') send(); });
      root.querySelector('#collabInvite').onclick = () => location.href = 'mailto:?subject=Runlet проект&body=' + encodeURIComponent(location.href);
      root.querySelector('#collabTeacher').onclick = () => { setReadOnly(true); toast('Режим преподавателя: студенты видят read-only', 'ok'); };
      window.__collabChat = chat;
    } });
}
