/* Floating window manager — real windowed mode inside the program.
   Windows can host an iframe (site / preview) or an existing DOM panel
   (editors, 3D, console). Panels are restored to their exact place on close. */
import { state, ctx, $, $$, el, emit, on } from './core.js';
import { icon as svg } from './icons.js';

let layer = null;
let zTop = 900;
const wins = new Map();
let cascade = 0;

function ensureLayer() {
  if (!layer) layer = $('#windowsLayer');
  return layer;
}
function focus(win) {
  win.el.style.zIndex = ++zTop;
  $$('.float-window').forEach(w => w.classList.remove('fw-focus'));
  win.el.classList.add('fw-focus');
}
function clamp(win) {
  const r = win.el.getBoundingClientRect();
  if (r.left < 4) win.el.style.left = '4px';
  if (r.top < 4) win.el.style.top = '4px';
  if (r.right > innerWidth - 4) win.el.style.left = Math.max(4, innerWidth - r.width - 8) + 'px';
  if (r.bottom > innerHeight - 4) win.el.style.top = Math.max(4, innerHeight - r.height - 8) + 'px';
}

export function openWindow(opts = {}) {
  const host = ensureLayer(); if (!host) return null;
  const id = opts.id || ('w' + Math.random().toString(36).slice(2, 8));
  if (wins.has(id)) { const w = wins.get(id); focus(w); w.el.classList.remove('fw-min'); return w; }
  const width = Math.min(opts.width || 620, Math.max(360, innerWidth - 40));
  const height = Math.min(opts.height || 420, Math.max(260, innerHeight - 60));
  const x = opts.x ?? Math.min(innerWidth - width - 20, 80 + (cascade % 7) * 28);
  const y = opts.y ?? Math.min(innerHeight - height - 20, 60 + (cascade % 7) * 24);
  cascade++;
  const node = el('div', { class: 'float-window', style: {
    left: x + 'px', top: y + 'px', width: width + 'px', height: height + 'px'
  } });
  const head = el('div', { class: 'fw-head' });
  head.innerHTML = `<span class="fw-title">${svg(opts.icon || 'window', 14)} <span>${escapeText(opts.title || 'Окно')}</span></span>
    <span class="fw-actions">
      <button class="fw-btn" data-fw="min" title="Свернуть">${svg('minus', 13)}</button>
      <button class="fw-btn" data-fw="max" title="Развернуть">${svg('maximize', 13)}</button>
      <button class="fw-btn" data-fw="close" title="Закрыть">${svg('close', 13)}</button>
    </span>`;
  const body = el('div', { class: 'fw-body' });
  const resize = el('div', { class: 'fw-resize' });
  node.append(head, body, resize);
  host.appendChild(node);

  const win = { id, el: node, body, opts, restore: null };
  wins.set(id, win);

  if (opts.url) {
    const f = document.createElement('iframe');
    f.src = opts.url;
    f.title = opts.title || 'Сайт';
    f.setAttribute('referrerpolicy', 'no-referrer');
    f.setAttribute('sandbox', 'allow-scripts allow-forms allow-same-origin');
    body.appendChild(f);
    win.iframe = f;
  } else if (opts.html) {
    const f = document.createElement('iframe');
    f.title = opts.title || 'Предпросмотр';
    f.setAttribute('referrerpolicy', 'no-referrer');
    f.setAttribute('sandbox', 'allow-scripts allow-forms');
    f.srcdoc = opts.html;
    body.appendChild(f);
    win.iframe = f;
  } else if (opts.content) {
    body.appendChild(opts.content);
    body.style.display = 'flex';
    body.style.flexDirection = 'column';
  }
  if (opts.restore) win.restore = opts.restore;

  // drag
  let drag = null;
  head.addEventListener('pointerdown', e => {
    if (e.target.closest('.fw-btn')) return;
    focus(win);
    const r = node.getBoundingClientRect();
    drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    head.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  head.addEventListener('pointermove', e => {
    if (!drag) return;
    node.style.left = Math.max(0, Math.min(innerWidth - 60, e.clientX - drag.dx)) + 'px';
    node.style.top = Math.max(0, Math.min(innerHeight - 40, e.clientY - drag.dy)) + 'px';
  });
  head.addEventListener('pointerup', () => { drag = null; clamp(win); });
  head.addEventListener('pointercancel', () => { drag = null; });
  node.addEventListener('pointerdown', () => focus(win));

  // resize
  let rz = null;
  resize.addEventListener('pointerdown', e => {
    focus(win);
    const r = node.getBoundingClientRect();
    rz = { w: r.width, h: r.height, x: e.clientX, y: e.clientY };
    resize.setPointerCapture(e.pointerId);
    e.preventDefault(); e.stopPropagation();
  });
  resize.addEventListener('pointermove', e => {
    if (!rz) return;
    node.style.width = Math.max(280, rz.w + e.clientX - rz.x) + 'px';
    node.style.height = Math.max(180, rz.h + e.clientY - rz.y) + 'px';
    emit('windows:changed');
  });
  resize.addEventListener('pointerup', () => { rz = null; clamp(win); emit('windows:changed'); });

  head.querySelector('[data-fw="min"]').onclick = () => node.classList.toggle('fw-min');
  head.querySelector('[data-fw="max"]').onclick = () => {
    if (win.maxRect) {
      Object.assign(node.style, win.maxRect); win.maxRect = null;
    } else {
      win.maxRect = { left: node.style.left, top: node.style.top, width: node.style.width, height: node.style.height };
      Object.assign(node.style, { left: '10px', top: '10px', width: (innerWidth - 20) + 'px', height: (innerHeight - 20) + 'px' });
    }
    emit('windows:changed');
  };
  head.querySelector('[data-fw="close"]').onclick = () => closeWindow(id);
  focus(win);
  emit('windows:changed');
  return win;
}
function escapeText(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function closeWindow(id) {
  const win = wins.get(id); if (!win) return false;
  try { win.restore?.(); } catch (e) { console.warn('[windows] restore', e); }
  try { win.opts.onClose?.(); } catch (_) { }
  win.el.remove(); wins.delete(id);
  emit('windows:changed');
  return true;
}
export function closeAllWindows() { for (const id of [...wins.keys()]) closeWindow(id); }
export function hasWindow(id) { return wins.has(id); }
export function windowCount() { return wins.size; }
export function refreshSiteWindow(url) {
  const w = wins.get('site');
  if (w?.iframe) { w.iframe.src = url; return true; }
  return false;
}

/** Move an existing panel into a window; restore it exactly on close. */
export function movePanelWindow(node, opts) {
  if (!node || !node.parentNode) return null;
  const parent = node.parentNode;
  const next = node.nextSibling;
  const placeholder = el('div', { class: 'panel-placeholder', style: { flex: '1', minHeight: '40px' } });
  parent.insertBefore(placeholder, node);
  const saved = node.getAttribute('style') || '';
  node.style.flex = '1 1 auto'; node.style.minHeight = '0'; node.style.minWidth = '0';
  return openWindow({
    ...opts,
    content: node,
    restore: () => {
      node.setAttribute('style', saved);
      if (placeholder.parentNode) parent.insertBefore(node, placeholder);
      else parent.appendChild(node);
      placeholder.remove();
      emit('windows:changed');
    }
  });
}

export function detachEditor(pane) {
  const node = $(`.editor-pane[data-pane="${pane}"]`);
  if (!node) return null;
  const id = 'editor-' + pane;
  if (wins.has(id)) { closeWindow(id); return null; }
  return movePanelWindow(node, { id, title: `Редактор · ${pane.toUpperCase()}`, icon: 'code', width: 700, height: 480 });
}

export function openSiteWindow(url, html) {
  if (wins.has('site')) { const w = wins.get('site'); focus(w); if (url && w.iframe) w.iframe.src = url; return w; }
  return openWindow({ id: 'site', title: 'Сайт — Live Server', icon: 'globe', width: 940, height: 660,
                      ...(url ? { url } : { html }) });
}

let windowed = false;
export function isWindowed() { return windowed; }
export function toggleWindowedMode() {
  windowed = !windowed;
  $('#app')?.classList.toggle('windowed-mode', windowed);
  if (windowed) {
    const live = ctx.liveStatus?.();
    openSiteWindow(live?.running ? live.url : null, ctx.srcdoc?.());
    const three = $('#threePanel');
    if (three) movePanelWindow(three, { id: 'win-three', title: '3D-редактор', icon: 'cube', width: 760, height: 520 });
    const cons = $('#consolePanel');
    if (cons) movePanelWindow(cons, { id: 'win-console', title: 'Консоль', icon: 'terminal', width: 620, height: 360 });
  } else {
    for (const id of ['site', 'win-three', 'win-console']) closeWindow(id);
  }
  state.settings.windowedMode = windowed;
  ctx.applySettings?.();
  emit('windows:changed');
  return windowed;
}
export function initWindows() {
  ensureLayer();
  on('live:changed', st => {
    if (st?.running && st?.url) refreshSiteWindow(st.url);
  });
  window.addEventListener('resize', () => { for (const w of wins.values()) clamp(w); });
}
