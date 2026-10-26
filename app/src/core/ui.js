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
import {
  generators, convertColor, contrast, contrastVerdict, paletteFrom, hexToRgb,
  specificity, unitConvert, formatJSON, validateJSON, jsonToJS, visualizeJSON,
  generateMockData, uuid, randomColor, generateSEO, generateReadme, generateDocs,
  generateTests, extractCssFromHtml, darkThemeFrom, perfTips, securityScan,
  SVG_ICONS, faviconFrom, placeholderImage
} from './tools.js';

let modalRoot, activeModal = null;
let tourSteps = [], tourIndex = 0;

export function initUI() {
  modalRoot = $('#modalRoot');
  applyTheme(); applyLocale();
  initTabs(); initSplitters(); initHotkeys(); initWindowControls();
  document.addEventListener('click', e => {
    const btn = e.target.closest('[data-cmd]');
    if (!btn) return;
    e.preventDefault();
    const id = btn.dataset.cmd;
    let arg = btn.dataset.arg;
    if (btn.dataset.rid) arg = { id: btn.dataset.rid, line: +btn.dataset.line };
    runCommand(id, arg);
  });
  $('#accentInput')?.addEventListener('input', debounce(e => {
    state.settings.accent = e.target.value; applySettings();
  }, 120));
  $('#projectName')?.addEventListener('input', e => { state.projectName = e.target.value; });
  on('toast', d => toast(d.msg, d.type));
  on('project:restoreEditors', syncEditorLabels);
  on('settings:changed', () => {
    $('#optAutoRun') && ($('#optAutoRun').checked = state.settings.autoRun);
    $('#zoomSelect') && ($('#zoomSelect').value = String(state.zoom));
  });
  on('files:changed', ({ path, removed }) => {
    const pane = Object.entries(state.panes).find(([, p]) => p === path)?.[0];
    if (pane) {
      const label = $(`[data-pane-file="${pane}"]`);
      if (label) label.textContent = path;
    }
  });
  if (state.settings.firstRun) setTimeout(() => showStartScreen(), 450);
  applyLayout(state.layout);
}

/* ── tabs ───────────────────────────────────────────────────────── */
function initTabs() {
  $('#railTabs')?.addEventListener('click', e => {
    const t = e.target.closest('[data-rail-tab]'); if (!t) return;
    $$('.rail-tab').forEach(x => x.classList.toggle('active', x === t));
    $$('.rail-panel').forEach(x => x.classList.toggle('active', x.dataset.rail === t.dataset.railTab));
    emit('rail:tab', t.dataset.railTab);
  });
  $('#inspectorTabs')?.addEventListener('click', e => {
    const t = e.target.closest('[data-insp-tab]'); if (!t) return;
    $$('.insp-tab').forEach(x => x.classList.toggle('active', x === t));
    $$('.insp-panel').forEach(x => x.classList.toggle('active', x.dataset.insp === t.dataset.inspTab));
    emit('insp:tab', t.dataset.inspTab);
    if (['dom', 'network', 'storage', 'perf', 'debug'].includes(t.dataset.inspTab)) ctx.refreshInspectors?.();
  });
  $('#editors')?.addEventListener('click', e => {
    const t = e.target.closest('[data-pane-tab]'); if (!t) return;
    focusPane(t.dataset.paneTab);
    if (state.layout === 'tabs') applyLayout('tabs', t.dataset.paneTab);
  });
}
export function selectRailTab(name) { $(`[data-rail-tab="${name}"]`)?.click(); }
export function selectInspTab(name) { $(`[data-insp-tab="${name}"]`)?.click(); }

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
    title: '⚡ Палитра команд', wide: true, cancelText: '', okText: 'Закрыть',
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
            id: 'open:' + p, title: p, group: 'Файлы', icon: '📄', run: () => ctx.openFile(p)
          }));
        } else if (ql.startsWith(':')) {
          const n = +ql.slice(1) || 1;
          pool = [{ id: 'goto', title: `Перейти к строке ${n}`, group: 'Навигация', icon: '↗', run: () => ctx.gotoLine(n) }];
        } else {
          pool = cmds.filter(c => (c.title + ' ' + (c.group || '') + ' ' + c.id).toLowerCase().includes(ql));
        }
        items = pool.slice(0, 60); active = 0;
        list.innerHTML = '';
        let lastGroup = '';
        items.forEach((c, i) => {
          if (c.group !== lastGroup) { list.appendChild(el('div', { class: 'cmd-group-title', text: c.group || 'Разное' })); lastGroup = c.group; }
          const node = el('div', { class: 'cmd-item ' + (i === 0 ? 'active' : ''), 'data-i': i },
            el('span', { class: 'cmd-ico', text: c.icon || '›' }),
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
  const field = (label, key, type = 'number', extra = '') => `<div class="field"><label>${label}</label>
    <input data-set="${key}" type="${type}" ${type === 'checkbox' ? (s[key] ? 'checked' : '') : `value="${type === 'color' ? s[key] : s[key]}"`} ${extra}></div>`;
  const bool = (label, key) => `<label class="chk" style="margin:4px 0"><input type="checkbox" data-set="${key}" ${s[key] ? 'checked' : ''}> ${label}</label>`;
  const pages = {
    editor: `<div class="field-row">
        ${field('Размер шрифта', 'fontSize', 'number', 'min="9" max="28"')}
        ${field('Межстрочный интервал', 'lineHeight', 'number', 'step="0.1" min="1" max="2.5"')}
        ${field('Ширина табуляции', 'tabSize', 'number', 'min="1" max="8"')}
        <div class="field"><label>Шрифт</label><select data-set="fontFamily">
          ${['mono', 'system', 'courier', 'sans'].map(v => `<option value="${v}" ${s.fontFamily === v ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
        <div class="field"><label>Стиль курсора</label><select data-set="cursorStyle">
          <option value="smooth" ${s.cursorStyle === 'smooth' ? 'selected' : ''}>плавный</option>
          <option value="block" ${s.cursorStyle === 'block' ? 'selected' : ''}>блок</option></select></div>
        <div class="field"><label>Локаль интерфейса</label><select data-set="locale">
          <option value="ru" ${s.locale === 'ru' ? 'selected' : ''}>Русский</option>
          <option value="en" ${s.locale === 'en' ? 'selected' : ''}>English</option></select></div>
      </div>
      <h4 style="margin:12px 0 4px">Отображение</h4><div class="rowflex">
        ${bool('Пробелы и табы', 'showWhitespace')}${bool('Невидимые символы', 'showInvisibles')}
        ${bool('Перенос строк', 'wrap')}${bool('Мини-карта', 'minimap')}${bool('Хлебные крошки', 'breadcrumbs')}
        ${bool('Плавная прокрутка', 'smoothScroll')}${bool('Липкие заголовки', 'stickyHeaders')}
        ${bool('Убирать пробелы в конце строк', 'trimTrailingWhitespace')}${bool('Подсветка кода→предпросмотр', 'codeToPreview')}
      </div><h4 style="margin:12px 0 4px">Пресеты</h4><div class="tabs-line">${Object.entries(PRESETS).map(([k, v]) =>
        `<button data-preset="${k}" class="${s.presets === k ? 'active' : ''}">${v.label}</button>`).join('')}</div>`,
    preview: `<div class="field-row">
        ${field('Задержка автозапуска (мс)', 'autoRunDelay', 'number', 'min="100" max="5000"')}
        ${field('Задержка анализа (мс)', 'autoAnalyzeDelay', 'number', 'min="300" max="10000"')}
        ${field('Автосохранение (сек)', 'autoSaveInterval', 'number', 'min="5" max="300"')}
        ${field('Лимит времени скрипта (мс)', 'timeLimit', 'number', 'min="500" max="30000"')}
      </div><div class="rowflex">
        ${bool('Автозапуск предпросмотра', 'autoRun')}${bool('Автоанализ кода', 'autoAnalyze')}
        ${bool('Автосохранение', 'autoSave')}${bool('CSS hot swap', 'hotCss')}${bool('JS hot reload', 'hotJs')}
        ${bool('Подтверждать удаление', 'confirmDelete')}${bool('Подсказки при первом запуске', 'firstRun')}
      </div>
      <h4 style="margin:12px 0 4px">Разрешения sandbox предпросмотра</h4>
      <p class="muted" style="font-size:10.5px;margin:0 0 6px">По умолчанию выключены — включайте только для доверенных проектов. Опции расширяют права кода из открытой ссылки.</p>
      <div class="rowflex" id="sandboxOpts">
        ${[['forms','Формы'],['popups','Новые окна'],['modals','Модальные окна'],['downloads','Скачивания'],['pointerLock','Pointer lock'],['orientationLock','Ориентация']].map(([k,l]) =>
          `<label class="chk"><input type="checkbox" data-sandbox="${k}" ${s.sandboxPermissions?.[k] ? 'checked' : ''}> ${l}</label>`).join('')}
      </div>
      <div class="beginner mt8">Предпросмотр работает в изолированном iframe (<code class="inline">sandbox</code> без <code class="inline">allow-same-origin</code>): cookies, localStorage и сеть контролируются мостом редактора. Сообщения принимаются только от текущего документа по одноразовому идентификатору.</div>`,
    keys: `<p class="muted">Кликните по полю и нажмите сочетание клавиш. Изменения применяются сразу.</p>
      <div class="field-row">${Object.entries(s.keybindings).map(([k, v]) =>
        `<div class="field"><label>${esc(commandTitle(k))}</label><input data-key="${k}" value="${esc(v)}" readonly style="cursor:pointer"></div>`).join('')}</div>`,
    theme: `<div class="field-row">
        <div class="field"><label>Тема</label><select data-set="theme">
          ${['auto', 'dark', 'light', 'contrast'].map(v => `<option value="${v}" ${s.theme === v ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
        ${field('Акцентный цвет', 'accent', 'color')}
        <div class="field"><label>Плотность</label><select data-set="density">
          <option value="comfy" ${s.density === 'comfy' ? 'selected' : ''}>просторно</option>
          <option value="compact" ${s.density === 'compact' ? 'selected' : ''}>компактно</option></select></div>
      </div><div class="gen-preview" style="background:linear-gradient(135deg,var(--accent),var(--accent2));border-radius:16px">Предпросмотр акцента</div>`,
    storage: `<div class="list-rows">
        <div class="list-row"><div class="grow"><b>Размер проекта</b><small>${fmtBytes(Object.values(state.files).reduce((n, f) => n + f.content.length, 0))}</small></div></div>
        <div class="list-row"><div class="grow"><b>Файлов</b><small>${listFiles().length}</small></div></div>
        <div class="list-row"><div class="grow"><b>Снапшотов</b><small>${state.snapshots.length}</small></div></div></div>
      <div class="tabs-line mt8"><button id="setExport">⬇ Экспорт настроек</button><button id="setImport">⬆ Импорт</button>
        <button id="setReset">↺ Сброс</button><button id="setSave">💾 Сохранить сейчас</button></div>`,
    about: `<div style="text-align:center;padding:10px"><div class="brand-mark" style="margin:auto;width:60px;height:60px;border-radius:20px;font-size:28px">⚡</div>
      <h2 style="margin:12px 0 2px">Runlet Studio 1.0</h2><p class="muted">Редактор HTML / CSS / JS на Electron с Python-движком анализа кода.</p></div>
      <div class="list-rows"><div class="list-row"><b>Движок</b><div class="grow" style="text-align:right">${esc(state.engine)}</div></div>
      <div class="list-row"><b>Реализовано идей</b><div class="grow" style="text-align:right">${coverage().done} / ${coverage().total}</div></div>
      <div class="list-row"><b>Платформа</b><div class="grow" style="text-align:right">${window.runlet?.platform || navigator.platform}</div></div></div>
      <p class="muted mt8" style="font-size:11px">Ядро анализа: Python 3 (stdlib only). Редактор: CodeMirror 6. Сборка: esbuild + Electron.</p>`
  };
  modal({ title: '⚙ Настройки Runlet', wide: true, okText: 'Готово',
    body: `<div class="tabs-line" id="setTabs">${Object.entries({ editor: 'Редактор', preview: 'Предпросмотр', keys: 'Горячие клавиши', theme: 'Внешний вид', storage: 'Хранилище', about: 'О программе' }).map(([k, v]) =>
      `<button data-st="${k}" class="${k === tab ? 'active' : ''}">${v}</button>`).join('')}</div><div id="setBody">${pages[tab]}</div>`,
    onMount: root => {
      const body = root.querySelector('#setBody');
      const mount = t => {
        body.innerHTML = pages[t];
        body.querySelectorAll('[data-set]').forEach(inp => {
          inp.addEventListener('change', () => {
            const k = inp.dataset.set;
            const v = inp.type === 'checkbox' ? inp.checked : (inp.type === 'number' ? +inp.value : inp.value);
            state.settings[k] = v; applySettings();
          });
          inp.addEventListener('input', () => {
            if (inp.type === 'color') { state.settings.accent = inp.value; applyTheme(); }
          });
        });
        body.querySelectorAll('[data-key]').forEach(inp => {
          inp.addEventListener('keydown', e => {
            e.preventDefault(); e.stopPropagation();
            if (e.key === 'Escape') { inp.value = state.settings.keybindings[inp.dataset.key]; return; }
            inp.value = keyEventToString(e);
            state.settings.keybindings[inp.dataset.key] = inp.value;
            applySettings(); toast('Горячая клавиша обновлена', 'ok');
          });
        });
        body.querySelectorAll('[data-sandbox]').forEach(inp => {
          inp.addEventListener('change', () => {
            state.settings.sandboxPermissions = { ...(state.settings.sandboxPermissions || {}), [inp.dataset.sandbox]: inp.checked };
            applySettings();
          });
        });
        body.querySelectorAll('[data-preset]').forEach(b => b.onclick = () => { applyPreset(b.dataset.preset); closeModal(); settingsModal(t); });
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
    `<div class="kv"><span>${esc(commandTitle(k))}</span><b><kbd>${esc(v)}</kbd></b></div>`).join('');
  modal({ title: '⌨ Горячие клавиши', wide: false, okText: 'Настроить',
    body: `<div class="debug-steps">${rows}</div><p class="muted mt8">В редакторе также работают: Ctrl+F (поиск), Ctrl+Z/Y (undo/redo), Alt+клик (вертикальный курсор), Ctrl+D (мультикурсор), Tab (Emmet/сниппет).</p>`,
    onOk: () => { setTimeout(() => settingsModal('keys'), 100); } });
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

/* ── start screen / tour ────────────────────────────────────────── */
export function showStartScreen() {
  const screen = $('#startScreen');
  const templates = [
    { id: 'demo', ico: '⚡', name: 'Демо-проект', desc: 'Красивая карточка со счётчиком кликов — всё уже настроено.' },
    { id: 'blank', ico: '📄', name: 'Пустой проект', desc: 'Чистый HTML5-скелет + style.css + script.js.' },
    { id: 'landing', ico: '🚀', name: 'Лендинг', desc: 'Hero-секция, навигация, карточки и футер.' },
    { id: 'form', ico: '📝', name: 'Форма', desc: 'Форма с валидацией и доступными label.' },
    { id: 'game', ico: '🎮', name: 'Мини-игра', desc: 'Canvas + requestAnimationFrame + очки.' },
    { id: 'import', ico: '📥', name: 'Импорт', desc: 'ZIP, одиночный HTML или ссылка.' }
  ];
  screen.innerHTML = `<div class="start-card">
    <span class="pill pill-accent">Runlet Studio · Electron + Python analysis</span>
    <h1>Пиши код. <span>Понимай код.</span></h1>
    <p class="lead">Три панели, живой предпросмотр и движок, который объяснит, что скорее всего делает ваш код и где ошибки.</p>
    <div class="feature-strip"><span>🐍 Python-анализ</span><span>⚡ живой предпросмотр</span><span>🧠 объяснение поведения</span>
      <span>🛠 автоисправления</span><span>🎨 CSS-лаборатория</span><span>🎓 уроки</span></div>
    <div class="grid-cards">${templates.map(t => `<div class="tile" data-tpl="${t.id}"><div class="tile-ico">${t.ico}</div>
      <b>${t.name}</b><small>${t.desc}</small></div>`).join('')}</div>
    <div class="rowflex mt8"><label class="chk"><input type="checkbox" id="noStart"> больше не показывать</label>
      <div style="flex:1"></div><button class="btn btn-ghost" id="startSkip">✕ Просто открыть редактор</button>
      <button class="btn btn-analyze" id="startTour">🚀 Быстрый тур</button></div>
  </div>`;
  screen.classList.add('show');
  screen.querySelectorAll('[data-tpl]').forEach(t => t.onclick = () => {
    state.settings.firstRun = !screen.querySelector('#noStart').checked;
    applySettings();
    startTemplate(t.dataset.tpl);
    screen.classList.remove('show');
  });
  screen.querySelector('#startTour').onclick = () => {
    state.settings.firstRun = false; applySettings();
    screen.classList.remove('show'); startTour();
  };
  screen.querySelector('#startSkip').onclick = () => {
    state.settings.firstRun = !screen.querySelector('#noStart').checked;
    applySettings(); screen.classList.remove('show');
    setTimeout(() => runCommand('analyze'), 200);
  };
}
export function startTemplate(id) {
  if (id === 'import') { runCommand('importZip'); return; }
  if (id === 'demo') { resetProject(); toast('Демо-проект загружен', 'ok'); return; }
  const blank = {
    'index.html': `<!DOCTYPE html>\n<html lang="ru">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>Проект</title>\n<link rel="stylesheet" href="style.css">\n</head>\n<body>\n  \n  <script src="script.js"></script>\n</body>\n</html>`,
    'style.css': '/* стили */\nbody { font-family: system-ui, sans-serif; margin: 0; padding: 24px; }\n',
    'script.js': '// код\n'
  };
  if (id === 'blank') {
    for (const [p, c] of Object.entries(blank)) write(p, c);
  } else if (id === 'landing') {
    blank['index.html'] = blank['index.html'].replace('  \n', [SNIPPETS.find(s => s.id === 'nav').code,
      SNIPPETS.find(s => s.id === 'hero').code, '<section class="cards">' + SNIPPETS.find(s => s.id === 'card').code.repeat(1) + '</section>',
      SNIPPETS.find(s => s.id === 'footer').code].join('\n'));
    blank['style.css'] += '\nbody{padding:0}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:18px;padding:24px}\n';
    for (const [p, c] of Object.entries(blank)) write(p, c);
  } else if (id === 'form') {
    blank['index.html'] = blank['index.html'].replace('  \n', SNIPPETS.find(s => s.id === 'form').code);
    blank['script.js'] = `document.querySelector('#myForm').addEventListener('submit', e => { e.preventDefault(); console.log('Форма отправлена', new FormData(e.target)); });`;
    for (const [p, c] of Object.entries(blank)) write(p, c);
  } else if (id === 'game') {
    blank['index.html'] = blank['index.html'].replace('  \n', '<canvas id="game" width="640" height="360" style="border-radius:20px;background:#10132a"></canvas>');
    blank['script.js'] = `const c = document.querySelector('#game'), x = c.getContext('2d');\nlet px = 60, py = 180, score = 0;\nfunction frame(){ x.clearRect(0,0,c.width,c.height); x.fillStyle='#7c6cf6'; x.fillRect(px,py,40,40); x.fillStyle='#fff'; x.font='20px sans-serif'; x.fillText('Очки: '+score, 20, 30); px=(px+2)%c.width; score++; requestAnimationFrame(frame); }\nframe();`;
    for (const [p, c] of Object.entries(blank)) write(p, c);
  }
  emit('project:restoreEditors'); runCommand('run');
  toast('Шаблон загружен', 'ok');
}

const TOUR = [
  { sel: '.brand-mark', title: 'Runlet Studio', text: 'Редактор HTML/CSS/JS на Electron. Всё сохраняется автоматически.' },
  { sel: '.editor-pane[data-pane="html"]', title: 'Три панели кода', text: 'HTML, CSS и JS рядом. Разделители можно перетаскивать, панели — сворачивать и разворачивать.' },
  { sel: '.btn-analyze', title: 'Анализ кода 🐍', text: 'Главная фишка: Python-движок объяснит, что делает код, найдёт ошибки и предложит исправления.' },
  { sel: '#inspectorTabs', title: 'Панель объяснений', text: 'Здесь отчёт, консоль, отладчик, DOM-инспектор, сеть, хранилище и ассистент.' },
  { sel: '#previewCard', title: 'Живой предпросмотр', text: 'Изолированный iframe с перехватом console, ошибок, alert и поддержкой устройств.' },
  { sel: '#railTabs', title: 'Файлы, библиотеки, уроки', text: 'Виртуальная ФС, ZIP, CDN-библиотеки, плагины и 500 идей с картой покрытия.' }
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
  modal({ title: `✦ Сниппеты · ${cat.toUpperCase()}`, wide: true, okText: 'Закрыть',
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
        modal({ title: '★ Новый сниппет', wide: true,
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
  modal({ title: '🧰 HTML-инструменты', wide: true, okText: 'Закрыть',
    body: `<div class="grid-cards" id="htmlGens">${gens.map(([n, f], i) => `<div class="tile" data-hg="${i}"><div class="tile-ico">🧩</div><b>${n}</b><small>Вставить в HTML</small></div>`).join('')}</div>
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
  modal({ title: '◐ CSS-лаборатория', wide: true, okText: 'Вставить CSS',
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
  modal({ title: '⚙ JS-инструменты', wide: true, okText: 'Закрыть',
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
        check: `<div class="rowflex"><button class="mini-btn" data-j="security">🔒 Безопасность</button>
          <button class="mini-btn" data-j="perf">⚡ Перфоманс</button><button class="mini-btn" data-j="syntax">✓ Синтаксис</button></div>
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
  modal({ title: '🎨 Цвет и контраст', narrow: true,
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
  modal({ title: '📚 Библиотеки и CDN', wide: true, okText: 'Закрыть',
    body: `<input id="libSearch2" placeholder="Поиск: tailwind, chart, react…" style="width:100%;height:34px;border-radius:11px;border:1px solid var(--border);background:var(--code-bg);padding:0 12px;margin-bottom:10px">
      <div class="list-rows" id="libSearchRows"></div>`,
    onMount: root => {
      const rows = root.querySelector('#libSearchRows');
      const draw = q => {
        rows.innerHTML = '';
        for (const l of CDN_LIBS.filter(x => (x.name + x.desc + x.cat).toLowerCase().includes(q.toLowerCase()))) {
          const row = el('div', { class: 'list-row' },
            el('div', { class: 'grow' }, el('b', { text: l.name }), el('small', { text: l.desc + ' · ' + l.cat })),
            el('button', { class: 'mini-btn', text: state.deps.some(d => (typeof d === 'string' ? d : d.id) === l.id) ? '✓' : '+' }));
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
  modal({ title: '👥 Совместная работа', wide: false, okText: 'Закрыть',
    body: `<div class="beginner">Синхронизация между вкладками одного браузера через BroadcastChannel: изменения файлов, чат и курсоры видны всем открытым окнам Runlet.</div>
      <div class="mt8"><b>Участники:</b> <span id="collabPeers">только вы</span></div>
      <div class="field mt8"><label>Чат</label><div id="collabChat" style="height:140px;overflow:auto;background:var(--code-bg);border-radius:12px;padding:8px;font-size:11px"></div></div>
      <div class="repl-bar"><input id="collabMsg" placeholder="Сообщение…"><button class="mini-btn" id="collabSend">➤</button></div>
      <div class="tabs-line mt8"><button id="collabInvite">✉ Пригласить по e-mail</button><button id="collabTeacher">Режим преподавателя</button></div>`,
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
