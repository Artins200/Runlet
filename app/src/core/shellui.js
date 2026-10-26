/* Shell UI: a normal windowed application shell, grouped dropdown menus and
   editor zoom. Works both in Electron (native frame) and in the browser, where
   the app becomes a real, minimizable window instead of a forced fullscreen. */
import { state, ctx, $, $$, el, esc, emit, on, toast, runCommand, commands,
         setFontZoom, toggleWrap } from './core.js';
import { icon } from './icons.js';
import { applySettings } from './state.js';

/* ── grouped menus ─────────────────────────────────────────────────── */
const MENUS = {
  file: {
    title: 'Файл', icon: 'folder', sections: [
      { label: 'Проект', items: [
        ['projectManager', 'Меню проектов'], ['save', 'Сохранить'],
        ['exportProject', 'Экспорт проекта'], ['importProject', 'Импорт проекта'],
        ['exportAllProjects', 'Экспорт всех проектов'] ] },
      { label: 'Файлы', items: [
        ['newFile', 'Новый файл'], ['newFolder', 'Новая папка'],
        ['upload', 'Загрузить с компьютера'], ['openOSFolder', 'Открыть папку с диска'] ] },
      { label: 'Обмен', items: [
        ['download', 'Скачать ZIP'], ['importZip', 'Импорт ZIP'],
        ['importHtml', 'Импорт HTML-файла'], ['importUrl', 'Импорт по ссылке'],
        ['exportSingleHtml', 'Собрать один HTML'], ['saveToDisk', 'Сохранить проект на диск'] ] }
    ]
  },
  more: {
    title: 'Ещё', icon: 'more', sections: [
      { label: 'Редактор', items: [
        ['format', 'Форматировать'], ['snippets', 'Сниппеты'], ['emmet', 'Развернуть Emmet'],
        ['gotoLine', 'Перейти к строке'], ['toggleWrap', 'Перенос строк'],
        ['fontZoomIn', 'Крупнее'], ['fontZoomOut', 'Мельче'] ] },
      { label: 'Запуск и инструменты', items: [
        ['liveServer', 'Live Server'], ['openSite', 'Сайт в окне'],
        ['openSiteExternal', 'Открыть в браузере'], ['openThreeD', '3D-редактор'],
        ['cssLab', 'CSS-лаборатория'], ['jsTools', 'JS-инструменты'],
        ['htmlTools', 'HTML-генераторы'], ['securityScan', 'Проверка безопасности'] ] },
      { label: 'Вид', items: [
        ['theme', 'Сменить тему'], ['density', 'Плотность'],
        ['layoutColumns', 'Три колонки'], ['layoutRows', 'Три строки'],
        ['layoutTabs', 'Вкладки'], ['windowedMode', 'Оконный режим'],
        ['appMinimize', 'Свернуть окно'], ['appMaximize', 'Развернуть на весь экран'] ] },
      { label: 'Справка', items: [
        ['analysisReport', 'Полный отчёт анализа'], ['tour', 'Тур по интерфейсу'],
        ['helpWelcome', 'Как работать'], ['learn', 'Уроки'],
        ['shortcuts', 'Горячие клавиши'], ['settings', 'Настройки'] ] }
    ]
  }
};

let menuLayer = null;
function closeMenu() {
  if (!menuLayer) return;
  menuLayer.innerHTML = '';
  menuLayer.classList.remove('show');
  $$('[data-menu]').forEach(b => b.classList.remove('active'));
}
export function openMenu(kind, anchor) {
  const def = MENUS[kind]; if (!def || !anchor) return;
  if (menuLayer?.classList.contains('show') && menuLayer.dataset.kind === kind) { closeMenu(); return; }
  closeMenu();
  menuLayer = menuLayer || $('#menuLayer');
  if (!menuLayer) return;
  menuLayer.dataset.kind = kind;
  const box = el('div', { class: 'dropdown-menu' });
  const head = el('div', { class: 'dropdown-head' });
  head.innerHTML = icon(def.icon, 15) + `<b>${esc(def.title)}</b>`;
  box.appendChild(head);
  for (const sec of def.sections) {
    box.appendChild(el('div', { class: 'dropdown-label', text: sec.label }));
    for (const [id, label] of sec.items) {
      const c = commands.get(id);
      // No data-cmd here: initUI() already delegates clicks on [data-cmd]
      // globally. Adding it would run every menu command twice (toggles would
      // flip straight back).
      const item = el('button', { class: 'dropdown-item', 'data-menu-item': id });
      const ic = c?.icon || 'chevronRight';
      item.innerHTML = `<span class="di-ico">${icon(ic, 15)}</span><span class="di-label">${esc(label)}</span>` + (c?.key ? `<kbd>${esc(c.key)}</kbd>` : '');
      item.addEventListener('click', e => {
        e.preventDefault(); e.stopPropagation();
        closeMenu(); runCommand(id);
      });
      box.appendChild(item);
    }
  }
  const r = anchor.getBoundingClientRect();
  box.style.left = Math.max(8, Math.min(innerWidth - 300, r.left)) + 'px';
  box.style.top = Math.max(8, Math.min(innerHeight - 460, r.bottom + 6)) + 'px';
  menuLayer.appendChild(box);
  menuLayer.classList.add('show');
  anchor.classList.add('active');
}
export function initMenus() {
  menuLayer = $('#menuLayer');
  $$('[data-menu]').forEach(btn => btn.addEventListener('click', e => {
    e.preventDefault(); e.stopPropagation();
    openMenu(btn.dataset.menu, btn);
  }));
  document.addEventListener('click', e => { if (!e.target.closest('.dropdown-menu') && !e.target.closest('[data-menu]')) closeMenu(); });
  window.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); }, true);
  window.addEventListener('resize', closeMenu);
}

/* ── windowed application shell ───────────────────────────────────── */
let native = false;
export function isNativeFrame() { return native; }
let lastWindowAction = 0;
export function windowControl(act) {
  const body = document.body;
  const now = Date.now();
  // A single click must never toggle twice (double listeners / double clicks).
  if (act === 'maximize' && now - lastWindowAction < 350) return;
  lastWindowAction = now;
  if (act === 'minimize' && body.classList.contains('app-min')) return;
  if (act === 'close' && body.classList.contains('app-closed')) return;
  if (act === 'restore' && !body.classList.contains('app-min') && !body.classList.contains('app-closed') && !native) return;

  if (act === 'minimize') {
    if (native) { window.runlet?.windowControl?.('minimize'); return; }
    body.classList.add('app-min'); body.classList.remove('app-closed');
    toast('Окно свёрнуто — нажмите Runlet в панели задач', 'info');
  } else if (act === 'maximize') {
    if (native) { window.runlet?.windowControl?.('maximize'); return; }
    body.classList.toggle('app-max');
    body.classList.remove('app-min', 'app-closed');
  } else if (act === 'close') {
    if (native) { window.runlet?.windowControl?.('close'); return; }
    body.classList.add('app-closed'); body.classList.remove('app-min');
  } else if (act === 'restore') {
    if (native) { window.runlet?.windowControl?.('restore'); return; }
    body.classList.remove('app-min', 'app-closed');
  } else return;
  emit('appwindow:changed', act);
}
export function initAppWindow() {
  // In Electron the OS owns the window whether the native frame is drawn or
  // not. Only the browser preview needs the in-app window simulation.
  native = !!window.runlet?.isElectron;
  const body = document.body;
  body.classList.toggle('native-frame', native && !!state.settings.nativeFrame);
  body.classList.toggle('windowed-app', !native && !!state.settings.appWindowed);
  const host = $('#winControls');
  if (host) {
    host.innerHTML = '';
    const defs = [
      ['minimize', 'minus', 'Свернуть'], ['maximize', 'maximize', 'Развернуть'], ['close', 'close', 'Закрыть']
    ];
    for (const [act, ic, title] of defs) {
      const b = el('button', { class: act === 'close' ? 'wc-close' : '', title,
                               'aria-label': title });
      b.innerHTML = icon(ic, 13);
      b.onclick = () => windowControl(act);
      host.appendChild(b);
    }
  }
  const bar = $('#desktopBar');
  if (bar) {
    bar.innerHTML = '';
    const btn = el('button', { class: 'taskbar-app', title: 'Вернуть Runlet' });
    btn.innerHTML = icon('code', 16) + '<span>Runlet</span>';
    btn.onclick = () => windowControl('restore');
    bar.appendChild(btn);
    const hint = el('span', { class: 'taskbar-hint', text: 'Окно свёрнуто' });
    bar.appendChild(hint);
  }
  const closed = $('#desktopClosed');
  if (closed) {
    closed.innerHTML = '';
    const card = el('div', { class: 'desktop-card' });
    card.innerHTML = `<div class="desktop-logo">${icon('code', 30)}</div>
      <h2>Runlet закрыт</h2><p>Приложение свёрнуто на рабочий стол. Данные проекта сохранены.</p>`;
    const open = el('button', { class: 'btn btn-accent', text: 'Открыть Runlet' });
    open.onclick = () => windowControl('restore');
    card.appendChild(open);
    closed.appendChild(card);
  }
  on('appwindow:changed', () => {
    const min = $('.taskbar-hint'); if (min) min.textContent = body.classList.contains('app-min') ? 'Окно свёрнуто' : 'Рабочий стол';
  });
}
export function setAppWindowed(v) {
  state.settings.appWindowed = !!v;
  document.body.classList.toggle('windowed-app', !native && !!v);
  applySettings();                 // persists + emits once, no manual re-emit
  return state.settings.appWindowed;
}

/* ── editor zoom ──────────────────────────────────────────────────── */
export function refreshZoomLabel() {
  const l = $('#fontSizeLabel'); if (l) l.textContent = Math.round(state.settings.fontSize) + 'px';
  const b = $('#wrapToggle'); if (b) b.classList.toggle('active', !!state.settings.wrap);
  const a = $('#animToggle'); if (a) a.classList.toggle('active', state.settings.animations !== false);
}
export function initZoom() {
  window.addEventListener('wheel', e => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    setFontZoom(e.deltaY < 0 ? 1 : -1);
    refreshZoomLabel();
  }, { passive: false });
  on('settings:changed', refreshZoomLabel);
  refreshZoomLabel();
}
