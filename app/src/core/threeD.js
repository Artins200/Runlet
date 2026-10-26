/* Built-in 3D modelling. A small self-contained software renderer on canvas 2D:
   place primitives, transform them, orbit the camera, export to the project.
   No WebGL, no CDN, works offline in Electron. */
import { state, ctx, $, el, esc, toast, on, emit } from './core.js';
import { write } from './state.js';
import { icon } from './icons.js';

const TYPES = [
  { id: 'cube', name: 'Куб', icon: 'cube' },
  { id: 'sphere', name: 'Сфера', icon: 'globe' },
  { id: 'cylinder', name: 'Цилиндр', icon: 'database' },
  { id: 'cone', name: 'Конус', icon: 'target' },
  { id: 'plane', name: 'Плоскость', icon: 'layers' },
  { id: 'torus', name: 'Тор', icon: 'refresh' }
];
const DEFAULT_COLORS = ['#4f8ff7', '#d97757', '#47a37c', '#d9b268', '#b48ce0', '#77b6d6'];

let host = null, canvas = null, g = null;
let objects = [];
let selected = null;
let cam = { yaw: 0.7, pitch: 0.45, dist: 7.5 };
let showGrid = true, wire = false;
let dirty = true, drag = null;
let panelRefs = {};
let stage = null, stageCanvas = null, stageG = null, visible = false, drawnPolys = 0, lastFrame = 0;

/* ── geometry ─────────────────────────────────────────────────────── */
function geometry(type) {
  const V = [], F = [];
  if (type === 'cube') {
    for (let z = -1; z <= 1; z += 2) for (let y = -1; y <= 1; y += 2) for (let x = -1; x <= 1; x += 2) V.push([x, y, z]);
    F.push([0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]);
  } else if (type === 'sphere') {
    const L = 14, R = 10;
    for (let i = 0; i <= R; i++) {
      const phi = Math.PI * i / R;
      for (let j = 0; j < L; j++) {
        const th = 2 * Math.PI * j / L;
        V.push([Math.sin(phi) * Math.cos(th), Math.cos(phi), Math.sin(phi) * Math.sin(th)]);
      }
    }
    for (let i = 0; i < R; i++) for (let j = 0; j < L; j++) {
      const a = i * L + j, b = i * L + (j + 1) % L;
      F.push([a, b, b + L, a + L]);
    }
  } else if (type === 'cylinder' || type === 'cone') {
    const N = 16;
    for (let i = 0; i < N; i++) {
      const a = 2 * Math.PI * i / N;
      V.push([Math.cos(a), -1, Math.sin(a)], [type === 'cone' ? 0 : Math.cos(a), 1, type === 'cone' ? 0 : Math.sin(a)]);
    }
    const top = V.length, bot = V.length + 1;
    V.push([0, 1, 0], [0, -1, 0]);
    for (let i = 0; i < N; i++) {
      const a = 2 * i, b = 2 * ((i + 1) % N);
      F.push([a, b, b + 1, a + 1]);
      if (type === 'cylinder') F.push([top, a + 1, b + 1]);
      F.push([bot, b, a]);
    }
  } else if (type === 'plane') {
    V.push([-1, 0, -1], [1, 0, -1], [1, 0, 1], [-1, 0, 1]);
    F.push([0, 1, 2, 3]);
  } else if (type === 'torus') {
    const A = 14, B = 8, R = 0.75, r = 0.3;
    for (let i = 0; i < A; i++) for (let j = 0; j < B; j++) {
      const u = 2 * Math.PI * i / A, v = 2 * Math.PI * j / B;
      V.push([(R + r * Math.cos(v)) * Math.cos(u), r * Math.sin(v), (R + r * Math.cos(v)) * Math.sin(u)]);
    }
    for (let i = 0; i < A; i++) for (let j = 0; j < B; j++) {
      const a = i * B + j, b = i * B + (j + 1) % B, c = ((i + 1) % A) * B + j, d = ((i + 1) % A) * B + (j + 1) % B;
      F.push([a, b, d, c]);
    }
  } else {
    V.push([-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1], [0, 1, 0]);
    F.push([0, 1, 2, 3], [0, 1, 4], [1, 2, 4], [2, 3, 4], [3, 0, 4]);
  }
  return { V, F };
}
const CACHE = {};
function geo(type) { return CACHE[type] || (CACHE[type] = geometry(type)); }

function rot(p, r) {
  let [x, y, z] = p;
  let c = Math.cos(r[0]), s = Math.sin(r[0]); [y, z] = [y * c - z * s, y * s + z * c];
  c = Math.cos(r[1]); s = Math.sin(r[1]); [x, z] = [x * c + z * s, -x * s + z * c];
  c = Math.cos(r[2]); s = Math.sin(r[2]); [x, y] = [x * c - y * s, x * s + y * c];
  return [x, y, z];
}
function worldPoint(o, p) {
  const q = rot([p[0] * o.scale[0], p[1] * o.scale[1], p[2] * o.scale[2]], o.rot);
  return [q[0] + o.pos[0], q[1] + o.pos[1], q[2] + o.pos[2]];
}
function cameraPoint(p) {
  const q = rot(p, [cam.pitch, cam.yaw, 0]);
  return [q[0], q[1], q[2] + cam.dist];
}
function project(p, w, h) {
  const c = cameraPoint(p), z = Math.max(0.15, c[2]);
  const f = Math.min(w, h) * 0.92 / z;
  return [w / 2 + c[0] * f, h / 2 - c[1] * f, c[2]];
}
function normal(a, b, c) {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const l = Math.hypot(...n) || 1;
  return [n[0] / l, n[1] / l, n[2] / l];
}
function shade(hex, k) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16), g2 = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return `rgb(${Math.round(Math.min(255, r * k))},${Math.round(Math.min(255, g2 * k))},${Math.round(Math.min(255, b * k))})`;
}

/* ── rendering ────────────────────────────────────────────────────── */
function render() {
  if (!stageCanvas || !stageG) return;
  canvas = stageCanvas; g = stageG;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const [w0, h0] = sizeCanvas();
  const w = w0 || canvas.clientWidth || 900, h = h0 || canvas.clientHeight || 520;
  if (!g) return;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  }
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  g.fillStyle = '#0b0f16'; g.fillRect(0, 0, w, h);

  if (showGrid) {
    g.lineWidth = 1; g.strokeStyle = 'rgba(120,150,190,.16)';
    for (let i = -5; i <= 5; i++) {
      drawLine3([i, -1.6, -5], [i, -1.6, 5], w, h);
      drawLine3([-5, -1.6, i], [5, -1.6, i], w, h);
    }
    g.strokeStyle = 'rgba(79,143,247,.55)';
    drawLine3([-5.4, -1.59, 0], [5.4, -1.59, 0], w, h);
    g.strokeStyle = 'rgba(215,119,87,.55)';
    drawLine3([0, -1.59, -5.4], [0, -1.59, 5.4], w, h);
  }

  const polys = [];
  for (const o of objects) {
    const gm = geo(o.type);
    const pts = gm.V.map(p => worldPoint(o, p));
    for (const f of gm.F) {
      const face = f.map(i => pts[i]);
      const cp = face.map(p => cameraPoint(p));
      const z = cp.reduce((n, p) => n + p[2], 0) / cp.length;
      const n = rot(normal(face[0], face[1], face[2]), [cam.pitch, cam.yaw, 0]);
      const light = [0.35, 0.72, 0.6];
      const dot = n[0] * light[0] + n[1] * light[1] + n[2] * light[2];
      polys.push({ z, face, n, k: 0.24 + 0.78 * Math.max(0, dot), o });
    }
  }
  polys.sort((a, b) => b.z - a.z);
  drawnPolys = polys.length;
  for (const p of polys) {
    const pr = p.face.map(v => project(v, w, h));
    if (pr.some(v => v[2] <= 0.15)) continue;
    g.beginPath(); g.moveTo(pr[0][0], pr[0][1]);
    for (let i = 1; i < pr.length; i++) g.lineTo(pr[i][0], pr[i][1]);
    g.closePath();
    const k = 0.2 + 0.8 * Math.max(0, p.k - 0.2);
    g.fillStyle = wire ? 'rgba(20,28,40,.35)' : shade(p.o.color, k);
    g.fill();
    g.lineWidth = selected === p.o.id ? 1.6 : 0.7;
    g.strokeStyle = selected === p.o.id ? '#ffd479' : (wire ? shade(p.o.color, 1.15) : 'rgba(0,0,0,.28)');
    g.stroke();
  }
  if (selected) {
    const o = objects.find(x => x.id === selected);
    if (o) {
      const pts = geo(o.type).V.map(p => project(worldPoint(o, p), w, h));
      const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
      const x0 = Math.min(...xs) - 5, y0 = Math.min(...ys) - 5, x1 = Math.max(...xs) + 5, y1 = Math.max(...ys) + 5;
      g.strokeStyle = 'rgba(255,212,121,.75)'; g.lineWidth = 1; g.setLineDash([4, 3]);
      g.strokeRect(x0, y0, x1 - x0, y1 - y0); g.setLineDash([]);
    }
  }
  dirty = false;
}
function drawLine3(a, b, w, h) {
  const p = project(a, w, h), q = project(b, w, h);
  if (p[2] <= 0.15 || q[2] <= 0.15) return;
  g.beginPath(); g.moveTo(p[0], p[1]); g.lineTo(q[0], q[1]); g.stroke();
}

/* ── scene operations ─────────────────────────────────────────────── */
function makeObject(type, offset = 0) {
  return {
    id: 'o' + Math.random().toString(36).slice(2, 8),
    type, name: (TYPES.find(t => t.id === type)?.name || 'Объект') + ' ' + (objects.length + 1),
    pos: [offset, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1],
    color: DEFAULT_COLORS[objects.length % DEFAULT_COLORS.length], wire: false
  };
}
export function addObject(type) {
  const n = objects.length;
  const o = makeObject(type, (n % 3 - 1) * 2.4);
  objects.push(o); selected = o.id;
  invalidate(); renderList(); renderProps();
  toast(`Добавлен: ${o.name}`, 'ok');
  return o;
}
export function clearScene() { objects = []; selected = null; invalidate(); renderList(); renderProps(); }
export function getScene() { return JSON.parse(JSON.stringify({ version: 1, objects })); }
export function setScene(scene) {
  objects = (scene?.objects || []).filter(o => TYPES.some(t => t.id === o.type)).map(o => ({
    id: o.id || makeObject(o.type).id, type: o.type, name: String(o.name || 'Объект').slice(0, 60),
    pos: Array.isArray(o.pos) ? o.pos.slice(0, 3).map(Number) : [0, 0, 0],
    rot: Array.isArray(o.rot) ? o.rot.slice(0, 3).map(Number) : [0, 0, 0],
    scale: Array.isArray(o.scale) ? o.scale.slice(0, 3).map(Number) : [1, 1, 1],
    color: /^#[0-9a-f]{6}$/i.test(o.color) ? o.color : '#4f8ff7', wire: !!o.wire
  }));
  selected = objects[0]?.id || null;
  invalidate(); renderList(); renderProps();
}
function current() { return objects.find(o => o.id === selected); }

/* ── UI: a dedicated large stage (a 200px rail panel cannot host a 3D
   viewport, and a hidden panel never reports a canvas size). ───────────── */
function sizeCanvas() {
  if (!stageCanvas || !stage) return [0, 0];
  const view = stageCanvas.parentElement;
  const r = view?.getBoundingClientRect();
  const w = Math.max(320, Math.round(r?.width || 0) || 0);
  const h = Math.max(240, Math.round(r?.height || 0) || 0);
  if (w < 320) return [0, 0];
  canvas = stageCanvas; g = stageG;
  return [w, h];
}
export function threeDRender() { dirty = true; render(); return threeDStats(); }
export function threeDStats() {
  return { objects: objects.length, selected, drawn: drawnPolys, visible,
           width: stageCanvas?.width || 0, height: stageCanvas?.height || 0 };
}
export function openThreeStage() {
  if (!stage) buildStage();
  if (!stage) return null;
  stage.classList.add('show');
  visible = true;
  const [w, h] = sizeCanvas();
  dirty = true;
  // Several frames: layout may settle asynchronously (fonts, flex, animation).
  render();
  requestAnimationFrame(() => { sizeCanvas(); dirty = true; render(); });
  setTimeout(() => { sizeCanvas(); dirty = true; render(); }, 120);
  setTimeout(() => { sizeCanvas(); dirty = true; render(); }, 420);
  emit('three:opened', { w, h });
  return stage;
}
export function closeThreeStage() {
  if (!stage) return;
  stage.classList.remove('show'); visible = false;
}
export function toggleThreeStage() { return visible ? (closeThreeStage(), false) : (openThreeStage(), true); }

function toolbarButtons(target, withLabels = true) {
  target.innerHTML = '';
  for (const t of TYPES) {
    const b = el('button', { class: 'mini-btn td-add', title: 'Добавить: ' + t.name,
                             'data-add': t.id });
    b.innerHTML = icon(t.icon, 14) + (withLabels ? `<span>${t.name}</span>` : '');
    b.onclick = () => { addObject(t.id); openThreeStage(); };
    target.appendChild(b);
  }
}
function buildStage() {
  stage = $('#threeStage'); if (!stage) return;
  stage.innerHTML = `<div class="three-stage-head">
      <div class="three-stage-title">${icon('cube', 17)}<b>3D-редактор</b>
        <span class="pill" id="tdBadge">объектов: 0</span></div>
      <div class="three-stage-actions">
        <button class="mini-btn" id="tdClear">Очистить</button>
        <button class="mini-btn" id="tdCamera">Сброс камеры</button>
        <button class="mini-btn" id="tdGrid">Сетка</button>
        <button class="mini-btn" id="tdWire">Каркас</button>
        <button class="mini-btn" id="tdExport">В проект</button>
        <button class="mini-btn" id="tdClose" title="Закрыть">${icon('close', 14)}</button>
      </div>
    </div>
    <div class="td-wrap">
      <div class="td-toolbar" id="tdToolbar"></div>
      <div class="td-main">
        <div class="td-view"><canvas class="td-canvas" id="tdCanvas" width="900" height="520"></canvas>
          <div class="td-badge" id="tdHint">объектов: 0</div>
          <div class="td-hint">Тяните мышью — вращение · колесо — зум · клик — выбор</div>
          <div class="td-error hidden" id="tdError"></div>
        </div>
        <div class="td-side">
          <h4>Объекты</h4><div class="td-list" id="tdList"></div>
          <div class="td-props" id="tdProps"></div>
        </div>
      </div>
    </div>`;
  stageCanvas = $('#tdCanvas');
  stageG = stageCanvas?.getContext('2d') || null;
  canvas = stageCanvas; g = stageG;
  panelRefs = { toolbar: $('#tdToolbar'), list: $('#tdList'), props: $('#tdProps'),
                badge: $('#tdBadge'), hint: $('#tdHint'), error: $('#tdError') };
  toolbarButtons(panelRefs.toolbar);
  if (!stageG) panelRefs.error.textContent = 'Canvas недоступен в этом окружении.';
  else panelRefs.error.classList.add('hidden');

  $('#tdGrid').onclick = () => { showGrid = !showGrid; $('#tdGrid').classList.toggle('active', showGrid); invalidate(); };
  $('#tdWire').onclick = () => { wire = !wire; $('#tdWire').classList.toggle('active', wire); invalidate(); };
  $('#tdCamera').onclick = () => { cam = { yaw: 0.7, pitch: 0.45, dist: 7.5 }; invalidate(); };
  $('#tdClear').onclick = () => { clearScene(); openThreeStage(); };
  $('#tdExport').onclick = exportToProject;
  $('#tdClose').onclick = closeThreeStage;
  $('#tdGrid').classList.toggle('active', showGrid);

  stageCanvas?.addEventListener('pointerdown', e => {
    const r = stageCanvas.getBoundingClientRect();
    drag = { x: e.clientX, y: e.clientY, yaw: cam.yaw, pitch: cam.pitch };
    stageCanvas.setPointerCapture(e.pointerId);
    pick(e.clientX - r.left, e.clientY - r.top);
  });
  stageCanvas?.addEventListener('pointermove', e => {
    if (!drag) return;
    cam.yaw = drag.yaw + (e.clientX - drag.x) * 0.008;
    cam.pitch = Math.max(-1.4, Math.min(1.4, drag.pitch + (e.clientY - drag.y) * 0.008));
    invalidate();
  });
  stageCanvas?.addEventListener('pointerup', () => { drag = null; });
  stageCanvas?.addEventListener('wheel', e => {
    e.preventDefault();
    cam.dist = Math.max(3, Math.min(24, cam.dist + e.deltaY * 0.012));
    invalidate();
  }, { passive: false });
  stage?.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft') { cam.yaw -= 0.15; invalidate(); }
    if (e.key === 'ArrowRight') { cam.yaw += 0.15; invalidate(); }
    if (e.key === 'ArrowUp') { cam.pitch = Math.max(-1.4, cam.pitch - 0.12); invalidate(); }
    if (e.key === 'ArrowDown') { cam.pitch = Math.min(1.4, cam.pitch + 0.12); invalidate(); }
    if (e.key === 'Escape') closeThreeStage();
  });
  stage.tabIndex = -1;
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => { sizeCanvas(); dirty = true; }) : null;
  ro?.observe(stageCanvas?.parentElement || stage);
  window.addEventListener('resize', () => { sizeCanvas(); dirty = true; });
  renderList(); renderProps();
}
export function initThreeD() {
  host = $('#threePanel');
  if (host) {
    host.innerHTML = `<div class="three-rail">
      <div class="three-rail-head"><div class="three-rail-ico">${icon('cube', 22)}</div>
        <div><b>3D-редактор</b><p>Ставьте примитивы, меняйте размер и поворот, экспортируйте сцену в проект.</p></div></div>
      <button class="btn btn-accent" id="tdOpen">${icon('maximize', 15)} Открыть редактор</button>
      <div class="three-rail-label">Добавить объект</div>
      <div class="three-rail-grid" id="tdRailAdd"></div>
      <div class="three-rail-summary" id="tdRailSummary"></div>
      <div class="three-rail-actions"><button class="mini-btn" id="tdRailExport">${icon('download', 13)} В проект</button></div>
    </div>`;
    toolbarButtons($('#tdRailAdd'), true);
    $('#tdOpen').onclick = () => openThreeStage();
    $('#tdRailExport').onclick = exportToProject;
  }
  buildStage();
  if (!objects.length) {
    addObject('cube');
    objects[0].pos = [-1.6, 0, 0];
    addObject('sphere');
    objects[1].pos = [1.6, 0, 0]; objects[1].color = '#d97757';
    selected = objects[0].id; invalidate();
  }
  on('three:show', () => openThreeStage());
  on('rail:tab', name => { if (name === 'three') openThreeStage(); });
  renderList(); renderProps();
  sizeCanvas();
  loop();
  emit('three:ready');
}
function pick(x, y) {
  if (!canvas) return;
  let best = null, bestArea = Infinity;
  const [w, h] = [canvas.clientWidth || 400, canvas.clientHeight || 300];
  for (const obj of objects) {
    const pts = geo(obj.type).V.map(p => project(worldPoint(obj, p), w, h));
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    if (x >= x0 && x <= x1 && y >= y0 && y <= y1) {
      const area = (x1 - x0) * (y1 - y0);
      if (area < bestArea) { bestArea = area; best = obj; }
    }
  }
  if (best && best.id !== selected) { selected = best.id; renderList(); renderProps(); invalidate(); }
}
function renderList() {
  if (!panelRefs.list) return;
  panelRefs.list.innerHTML = '';
  const label = 'объектов: ' + objects.length;
  if (panelRefs.badge) panelRefs.badge.textContent = label;
  if (panelRefs.hint) panelRefs.hint.textContent = label;
  const rail = $('#tdRailSummary');
  if (rail) rail.innerHTML = `${icon('layers', 14)} <b>${objects.length}</b> объектов · ${icon('cursor', 14)} выбран: ${esc(objects.find(o => o.id === selected)?.name || '—')}`;
  if (!objects.length) { panelRefs.list.innerHTML = '<div class="td-empty">Сцена пуста. Добавьте примитив.</div>'; return; }
  for (const o of objects) {
    const row = el('div', { class: 'td-item' + (o.id === selected ? ' active' : '') });
    row.innerHTML = `<span class="td-swatch" style="background:${esc(o.color)}"></span><span class="grow">${esc(o.name)}</span>
      <button class="mini-btn" data-del="${esc(o.id)}" title="Удалить" style="height:20px;padding:0 5px">${icon('trash', 11)}</button>`;
    row.onclick = () => { selected = o.id; renderList(); renderProps(); invalidate(); };
    row.querySelector('[data-del]').onclick = e => {
      e.stopPropagation();
      objects = objects.filter(x => x.id !== o.id);
      if (selected === o.id) selected = objects[0]?.id || null;
      renderList(); renderProps(); invalidate();
    };
    panelRefs.list.appendChild(row);
  }
}
function renderProps() {
  if (!panelRefs.props) return;
  const o = current();
  if (!o) { panelRefs.props.innerHTML = '<div class="td-empty">Выберите объект</div>'; return; }
  const inp = (key, i, step = 0.1) => `<input type="number" step="${step}" data-prop="${key}" data-i="${i}" value="${Number(o[key][i]).toFixed(2)}">`;
  const rot = (i) => `<input type="number" step="5" data-prop="rot" data-i="${i}" value="${Math.round(o.rot[i] * 180 / Math.PI)}">`;
  panelRefs.props.innerHTML = `
    <label>Имя</label><input id="tdName" value="${esc(o.name)}" maxlength="60">
    <label>Цвет</label><input type="color" id="tdColor" value="${esc(o.color)}" class="td-color">
    <label>Позиция X / Y / Z</label><div class="td-triple">${inp('pos', 0)}${inp('pos', 1)}${inp('pos', 2)}</div>
    <label>Поворот X / Y / Z (°)</label><div class="td-triple">${rot(0)}${rot(1)}${rot(2)}</div>
    <label>Масштаб X / Y / Z</label><div class="td-triple">${inp('scale', 0)}${inp('scale', 1)}${inp('scale', 2)}</div>
    <div class="rowflex mt8"><button class="mini-btn" id="tdDup">${icon('copy', 12)} Дублировать</button>
      <button class="mini-btn" id="tdReset">${icon('refresh', 12)} Сбросить</button></div>`;
  $('#tdName').oninput = e => { o.name = e.target.value.slice(0, 60); renderList(); };
  $('#tdColor').oninput = e => { o.color = e.target.value; renderList(); invalidate(); };
  panelRefs.props.querySelectorAll('[data-prop]').forEach(inp => {
    inp.onchange = () => {
      const key = inp.dataset.prop, i = +inp.dataset.i;
      let v = parseFloat(inp.value); if (!isFinite(v)) return;
      if (key === 'rot') v = v * Math.PI / 180;
      if (key === 'scale') v = Math.max(0.05, Math.min(8, v));
      o[key][i] = v; invalidate();
    };
  });
  $('#tdDup').onclick = () => {
    const c = JSON.parse(JSON.stringify(o)); c.id = makeObject(o.type).id;
    c.name = o.name + ' копия'; c.pos[0] += 1.2;
    objects.push(c); selected = c.id; renderList(); renderProps(); invalidate();
  };
  $('#tdReset').onclick = () => { o.pos = [0,0,0]; o.rot = [0,0,0]; o.scale = [1,1,1]; renderProps(); invalidate(); };
}
function invalidate() { dirty = true; }
function loop() {
  const now = performance.now();
  if (visible && g && now - lastFrame > 28) { lastFrame = now; dirty = true; }
  if (dirty) render();
  requestAnimationFrame(loop);
}
/* ── export ───────────────────────────────────────────────────────── */
function standaloneHtml(scene) {
  const data = JSON.stringify(scene).replace(/</g, '\\u003c');
  return `<!DOCTYPE html>
<html lang="ru"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>3D сцена — Runlet</title>
<style>html,body{margin:0;height:100%;background:#0b0f16;color:#9aa8ba;font-family:system-ui,sans-serif;overflow:hidden}
canvas{display:block;width:100%;height:100%;cursor:grab}#hud{position:fixed;left:14px;bottom:12px;font-size:12px;opacity:.7}</style></head>
<body><canvas id="c"></canvas><div id="hud">Тяните — вращение · колесо — зум · Runlet 3D</div>
<script>
const SCENE=${data}, c=document.getElementById('c'), x=c.getContext('2d');
let yaw=.7,pitch=.45,dist=8,drag=null,auto=true;
function make(t){const V=[],F=[];
 if(t==='cube'){for(let z=-1;z<=1;z+=2)for(let y=-1;y<=1;y+=2)for(let a=-1;a<=1;a+=2)V.push([a,y,z]);F.push([0,1,3,2],[4,6,7,5],[0,4,5,1],[2,3,7,6],[0,2,6,4],[1,5,7,3]);}
 else if(t==='sphere'){const L=14,R=10;for(let i=0;i<=R;i++)for(let j=0;j<L;j++){const p=Math.PI*i/R,q=2*Math.PI*j/L;V.push([Math.sin(p)*Math.cos(q),Math.cos(p),Math.sin(p)*Math.sin(q)]);}for(let i=0;i<R;i++)for(let j=0;j<L;j++){const a=i*L+j,b=i*L+(j+1)%L;F.push([a,b,b+L,a+L]);}}
 else if(t==='cylinder'||t==='cone'){const N=16;for(let i=0;i<N;i++){const a=2*Math.PI*i/N;V.push([Math.cos(a),-1,Math.sin(a)],[t==='cone'?0:Math.cos(a),1,t==='cone'?0:Math.sin(a)]);}const T=V.length,B=V.length+1;V.push([0,1,0],[0,-1,0]);for(let i=0;i<N;i++){const a=2*i,b=2*((i+1)%N);F.push([a,b,b+1,a+1]);if(t==='cylinder')F.push([T,a+1,b+1]);F.push([B,b,a]);}}
 else if(t==='plane'){V.push([-1,0,-1],[1,0,-1],[1,0,1],[-1,0,1]);F.push([0,1,2,3]);}
 else if(t==='torus'){const A=14,B=8,R=.75,r=.3;for(let i=0;i<A;i++)for(let j=0;j<B;j++){const u=2*Math.PI*i/A,v=2*Math.PI*j/B;V.push([(R+r*Math.cos(v))*Math.cos(u),r*Math.sin(v),(R+r*Math.cos(v))*Math.sin(u)]);}for(let i=0;i<A;i++)for(let j=0;j<B;j++){const a=i*B+j,b=i*B+(j+1)%B,d=((i+1)%A)*B+j,e=((i+1)%A)*B+(j+1)%B;F.push([a,b,e,d]);}}
 else{V.push([-1,-1,-1],[1,-1,-1],[1,-1,1],[-1,-1,1],[0,1,0]);F.push([0,1,2,3],[0,1,4],[1,2,4],[2,3,4],[3,0,4]);}
 return {V,F};}
const C={};function G(t){return C[t]||(C[t]=make(t));}
function rot(p,r){let[a,b,d]=p;let c=Math.cos(r[0]),s=Math.sin(r[0]);[b,d]=[b*c-d*s,b*s+d*c];c=Math.cos(r[1]);s=Math.sin(r[1]);[a,d]=[a*c+d*s,-a*s+d*c];c=Math.cos(r[2]);s=Math.sin(r[2]);[a,b]=[a*c-b*s,a*s+b*c];return[a,b,d];}
function wp(o,p){const q=rot([p[0]*o.scale[0],p[1]*o.scale[1],p[2]*o.scale[2]],o.rot);return[q[0]+o.pos[0],q[1]+o.pos[1],q[2]+o.pos[2]];}
function cp(p){const q=rot(p,[pitch,yaw,0]);return[q[0],q[1],q[2]+dist];}
function pr(p,w,h){const q=cp(p),z=Math.max(.15,q[2]),f=Math.min(w,h)*.92/z;return[w/2+q[0]*f,h/2-q[1]*f,z];}
function nrm(a,b,c){const u=[b[0]-a[0],b[1]-a[1],b[2]-a[2]],v=[c[0]-a[0],c[1]-a[1],c[2]-a[2]],n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],l=Math.hypot(...n)||1;return[n[0]/l,n[1]/l,n[2]/l];}
function sh(h,k){const s=h.replace('#','');const r=parseInt(s.slice(0,2),16),g=parseInt(s.slice(2,4),16),b=parseInt(s.slice(4,6),16);return'rgb('+Math.min(255,r*k|0)+','+Math.min(255,g*k|0)+','+Math.min(255,b*k|0)+')';}
function draw(){const d=Math.min(2,devicePixelRatio||1),w=c.clientWidth,h=c.clientHeight;c.width=w*d;c.height=h*d;x.setTransform(d,0,0,d,0,0);x.fillStyle='#0b0f16';x.fillRect(0,0,w,h);
 x.strokeStyle='rgba(120,150,190,.16)';x.lineWidth=1;for(let i=-5;i<=5;i++){const a=pr([i,-1.6,-5],w,h),b=pr([i,-1.6,5],w,h),e=pr([-5,-1.6,i],w,h),f=pr([5,-1.6,i],w,h);x.beginPath();x.moveTo(a[0],a[1]);x.lineTo(b[0],b[1]);x.moveTo(e[0],e[1]);x.lineTo(f[0],f[1]);x.stroke();}
 const P=[];for(const o of(SCENE.objects||[])){const gm=G(o.type),pts=gm.V.map(p=>wp(o,p));for(const F of gm.F){const face=F.map(i=>pts[i]);const z=face.reduce((n,p)=>n+cp(p)[2],0)/face.length;const n=rot(nrm(face[0],face[1],face[2]),[pitch,yaw,0]);const dot=n[0]*.35+n[1]*.72+n[2]*.6;P.push({z,face,k:.24+.78*Math.max(0,dot),o});}}
 P.sort((a,b)=>b.z-a.z);for(const p of P){const q=p.face.map(v=>pr(v,w,h));x.beginPath();x.moveTo(q[0][0],q[0][1]);for(let i=1;i<q.length;i++)x.lineTo(q[i][0],q[i][1]);x.closePath();const k=.2+.8*Math.max(0,p.k-.2);x.fillStyle=sh(p.o.color,k);x.fill();x.strokeStyle='rgba(0,0,0,.28)';x.lineWidth=.7;x.stroke();}
 if(auto&&!drag)yaw+=.0025;requestAnimationFrame(draw);}
c.addEventListener('pointerdown',e=>{drag={x:e.clientX,y:e.clientY,yaw,pitch};auto=false;c.setPointerCapture(e.pointerId);});
c.addEventListener('pointermove',e=>{if(!drag)return;yaw=drag.yaw+(e.clientX-drag.x)*.008;pitch=Math.max(-1.4,Math.min(1.4,drag.pitch+(e.clientY-drag.y)*.008));});
c.addEventListener('pointerup',()=>drag=null);
c.addEventListener('wheel',e=>{e.preventDefault();dist=Math.max(3,Math.min(24,dist+e.deltaY*.012));},{passive:false});
draw();
<\/script></body></html>`;
}
export function exportToProject() {
  const scene = getScene();
  write('scene.json', JSON.stringify(scene, null, 2));
  write('3d.html', standaloneHtml(scene));
  emit('files:changed', { path: '3d.html' });
  toast('Сцена сохранена: scene.json и 3d.html', 'ok');
  ctx.openFile?.('3d.html');
}
export function openThreeDWindow() { return openThreeStage(); }
export function threeDSummary() { return threeDStats(); }
