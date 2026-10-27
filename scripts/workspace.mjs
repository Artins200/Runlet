/* Regression: the VS Code-like workspace, default "index.html" file names and
   the reversible collapse / fold actions. Boots the real bundle in jsdom. */
import { JSDOM, VirtualConsole } from 'jsdom';
import fs from 'node:fs';

const ORIGIN = process.env.RUNLET_TEST_ORIGIN || 'http://localhost:4173';
const CTX = new Proxy({}, {
  get: (_, k) => {
    if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop() {} });
    if (k === 'measureText') return () => ({ width: 10 });
    if (k === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
    return () => {};
  },
  set: () => true
});

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`);
  cond ? pass++ : fail++;
};
const tick = (ms = 60) => new Promise(r => setTimeout(r, ms));

const html = await (await fetch(ORIGIN + '/')).text();
const bundle = fs.readFileSync('app/dist/bundle.js', 'utf8');
const vc = new VirtualConsole();
const errors = [];
vc.on('jsdomError', e => errors.push('jsdomError: ' + (e.message || '')));
vc.on('error', (...a) => errors.push('console.error: ' + a.map(String).join(' ')));
vc.on('warn', () => {});

const dom = new JSDOM(html, {
  url: ORIGIN + '/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc,
  beforeParse(w) {
    w.matchMedia = q => ({ matches: false, media: q, onchange: null,
      addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; } });
    w.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
    w.IntersectionObserver = w.ResizeObserver;
    w.PerformanceObserver = class { observe() {} disconnect() {} };
    w.BroadcastChannel = class { constructor() {} postMessage() {} close() {} onmessage = null; };
    w.fetch = (u, o) => globalThis.fetch(new URL(typeof u === 'string' ? u : u.url, ORIGIN), o);
    w.structuredClone = globalThis.structuredClone;
    w.CSS = { escape: s => String(s).replace(/[^a-zA-Z0-9_-]/g, c => '\\' + c) };
    w.HTMLCanvasElement.prototype.getContext = () => CTX;
    w.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,AA';
    w.Range.prototype.getClientRects = function () { return { length: 0, item: () => null, [Symbol.iterator]: function* () {} }; };
    w.Range.prototype.getBoundingClientRect = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 });
    w.Element.prototype.scrollIntoView = () => {};
    w.Element.prototype.setPointerCapture = () => {};
    w.URL.createObjectURL = () => 'blob:mock';
    w.URL.revokeObjectURL = () => {};
    w.open = () => ({ document: { open() {}, write() {}, close() {} } });
    Object.defineProperty(w.navigator, 'clipboard', { value: { writeText: async () => {} }, configurable: true });
  }
});
const w = dom.window;
w.addEventListener('error', e => errors.push('window.error: ' + (e.error?.stack || e.message)));
w.addEventListener('unhandledrejection', e => errors.push('unhandledrejection: ' + e.reason));
try { w.eval(bundle); } catch (e) { errors.push('eval: ' + (e.stack || e)); }
await tick(2600);
const $ = s => w.document.querySelector(s);
const $$ = s => [...w.document.querySelectorAll(s)];
const cmd = (id, arg) => w.Runlet?.runCommand(id, arg);
const click = el => el?.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));

/* ── 1. Focus workspace: one open file fills the screen ───────────── */
ok('Режим редактора включён по умолчанию', w.document.body.classList.contains('focus-mode') &&
   w.Runlet?.focusMode?.().enabled === true);
ok('Вкладки открытых файлов отрисованы', $$('#editorTabList .editor-tab').length === 3,
   $$('#editorTabList .editor-tab').map(t => t.textContent.trim()).join(', '));
ok('Видна ровно одна полноэкранная панель кода', $$('#editors > .editor-pane.focus-active').length === 1,
   $('#editors > .editor-pane.focus-active')?.dataset.pane);
ok('Панель предпросмотра по умолчанию скрыта', !w.document.body.classList.contains('focus-panel'));
ok('В статус-баре показан режим редактора', /Режим редактора/.test($('#statusMode')?.textContent || ''));
ok('Кодовая область — отдельная колонка рабочего пространства',
   $('#codeArea')?.parentElement?.id === 'workspace' && !!$('#codeArea #editors'));

/* ── 2. Opening a file from the Explorer switches the full-screen pane ── */
{
  const row = $$('#fileTree .tree-row').find(r => r.dataset.path === 'script.js');
  ok('Файл виден в проводнике', !!row);
  click(row);
  await tick(120);
  ok('Клик по файлу открывает его на весь экран',
     $('#editors > .editor-pane.focus-active')?.dataset.pane === 'js' &&
     $('#editorTabList .editor-tab.active')?.dataset.focusTab === 'js',
     'active=' + $('#editors > .editor-pane.focus-active')?.dataset.pane);
  ok('Вкладка показывает имя открытого файла',
     /script\.js/.test($('#editorTabList .editor-tab.active')?.textContent || ''));
}

/* ── 3. Toggling the workspace ─────────────────────────────────────── */
{
  cmd('toggleSidebar'); await tick(80);
  ok('Ctrl+B скрывает проводник', w.document.body.classList.contains('sidebar-hidden'));
  cmd('toggleSidebar'); await tick(80);
  ok('Ctrl+B возвращает проводник', !w.document.body.classList.contains('sidebar-hidden'));
  cmd('toggleFocusPanel'); await tick(80);
  ok('Ctrl+J открывает панель предпросмотра', w.document.body.classList.contains('focus-panel'));
  cmd('toggleFocusPanel'); await tick(80);
  ok('Ctrl+J закрывает панель предпросмотра', !w.document.body.classList.contains('focus-panel'));
  cmd('layoutRows'); await tick(80);
  ok('Классическая раскладка выходит из режима редактора',
     !w.document.body.classList.contains('focus-mode') && $('#editors')?.dataset.layout === 'rows');
  cmd('focusMode'); await tick(80);
  ok('F11 возвращает режим редактора', w.document.body.classList.contains('focus-mode'));
}

/* ── 4. Default file name is index.html ────────────────────────────── */
{
  cmd('newFile'); await tick(50);
  const name = $('#modalRoot #dlgName');
  ok('Диалог создания предлагает index.html', name?.value === 'index.html', name?.value);
  const type = $('#modalRoot #dlgType');
  if (type) {
    type.value = 'css';
    type.dispatchEvent(new w.Event('change', { bubbles: true }));
    ok('Смена типа сохраняет базовое имя index', name?.value === 'index.css', name?.value);
    type.value = 'html'; type.dispatchEvent(new w.Event('change', { bubbles: true }));
  }
  click($('#modalRoot .modal-foot .btn-analyze'));
  await tick(120);
  ok('Создание с занятым именем не падает и получает index-2.html',
     w.Runlet?.listFiles().includes('index-2.html'), w.Runlet?.listFiles().filter(f => /index/.test(f)).join(', '));
  click($('#modalRoot .close'));
  cmd('quickNewHtml'); await tick(120);
  ok('Быстрое создание тоже использует базу index',
     w.Runlet?.listFiles().some(f => /^index(-\d+)?\.html$/.test(f)) &&
     !w.Runlet?.listFiles().some(f => /^untitled/.test(f)),
     w.Runlet?.listFiles().filter(f => /\.html$/.test(f)).join(', '));
}

/* ── 5. Collapse is always reversible ──────────────────────────────── */
{
  cmd('collapsePane', 'html'); await tick(120);
  ok('Панель сворачивается', $('.editor-pane[data-pane="html"]')?.classList.contains('collapsed'));
  const btn = $('.editor-pane[data-pane="html"] [data-cmd="collapsePane"]');
  ok('На свёрнутой панели есть видимая кнопка «Развернуть»',
     /Развернуть/.test(btn?.title || '') && !!btn?.innerHTML.includes('svg'));
  ok('В полосе вкладок есть чип восстановления', !!$('#collapsedChips [data-expand-pane="html"]'));
  click($('#collapsedChips [data-expand-pane="html"]')); await tick(120);
  ok('Чип разворачивает панель обратно', !$('.editor-pane[data-pane="html"]')?.classList.contains('collapsed'));
  cmd('collapsePane', 'html'); await tick(100);
  click(btn); await tick(120);
  ok('Кнопка «Развернуть» разворачивает панель обратно',
     !$('.editor-pane[data-pane="html"]')?.classList.contains('collapsed'));
  cmd('collapsePane', 'css'); cmd('collapsePane', 'js'); await tick(120);
  cmd('restorePanes'); await tick(120);
  ok('«Развернуть все панели» снимает все свёрнутые состояния',
     $$('.editor-pane.collapsed').length === 0 && $$('#collapsedChips .expand-chip').length === 0);
}

/* ── 6. Code folding is reversible from the same command ───────────── */
{
  const before = w.Runlet?.folded?.();
  cmd('foldAll'); await tick(60);
  const folded = w.Runlet?.folded?.();
  cmd('foldAll'); await tick(60);
  const after = w.Runlet?.folded?.();
  ok('Свернуть код → развернуть тем же действием', before === false && folded === true && after === false,
     `${before} → ${folded} → ${after}`);
  cmd('foldAll'); cmd('unfoldAll'); await tick(60);
  ok('Команда «Развернуть всё» тоже работает', w.Runlet?.folded?.() === false);
}

/* ── 7. Maximized pane can always be restored ──────────────────────── */
{
  cmd('fullscreenPane', 'html'); await tick(120);
  ok('Панель разворачивается на весь экран', !!$('.editor-pane.maximized'));
  w.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await tick(120);
  ok('Esc возвращает панель на место', !$('.editor-pane.maximized'));
}

ok('Ошибок в консоли нет', errors.length === 0, errors.slice(0, 2).join(' | ').slice(0, 300));

console.log(`\n${pass} прошло, ${fail} упало (рабочее пространство).\n`);
dom.window.close();
process.exit(fail ? 1 : 0);
