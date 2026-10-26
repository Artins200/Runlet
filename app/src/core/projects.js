/* Project launcher: a real multi-project store instead of one anonymous session.
   Projects live in localStorage (and are mirrored to IndexedDB by state.js).
   Each record owns its files, entry point, panes and dependencies. */
import { state, ctx, $, emit, on, toast, download, esc, uid, debounce } from './core.js';
import { DEFAULT_FILES } from './core.js';
import { setProject, read, exists, listFiles, projectJSON, importProjectJSON } from './state.js';
import { icon } from './icons.js';

const LS = 'runlet:projects:v1';
const LS_ACTIVE = 'runlet:active-project:v1';

const BASE_HTML = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Мой сайт</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <main>
    <h1>Привет!</h1>
    <p>Пиши код в трёх панелях слева — результат появится справа.</p>
  </main>
  <script src="script.js"></script>
</body>
</html>`;
const BASE_CSS = `*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:system-ui,sans-serif;background:#eef1f6;color:#1b2431}
main{max-width:560px;padding:32px;border-radius:16px;background:#fff;border:1px solid #d6dde8;box-shadow:0 10px 30px rgba(20,30,50,.08)}
h1{margin:0 0 8px;font-size:32px;letter-spacing:-1px}
p{color:#5a6879;line-height:1.6}
`;
const BASE_JS = `// Точка входа вашего сайта
console.log('Runlet: страница загружена');
`;

const LANDING_HTML = `<!DOCTYPE html>
<html lang="ru"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Лендинг</title><link rel="stylesheet" href="style.css"></head><body>
<header class="site"><b>Brand</b><nav><a href="#features">Возможности</a><a href="#contacts">Контакты</a></nav></header>
<section class="hero"><span class="eyebrow">Новый продукт</span><h1>Заголовок, который цепляет</h1>
<p>Короткое описание вашего продукта в одном предложении.</p><a class="cta" href="#features">Начать</a></section>
<section class="cards" id="features"><article><h3>Быстро</h3><p>Мгновенный запуск.</p></article>
<article><h3>Просто</h3><p>Понятный интерфейс.</p></article><article><h3>Надёжно</h3><p>Проверено временем.</p></article></section>
<footer id="contacts">© 2026 Brand</footer></body></html>`;
const LANDING_CSS = `*{box-sizing:border-box}body{margin:0;font-family:system-ui,sans-serif;color:#1b2431;background:#f5f7fb}
.site{display:flex;justify-content:space-between;align-items:center;padding:18px 6vw;border-bottom:1px solid #e1e6ef}
.site nav{display:flex;gap:18px}.site a{color:#5a6879;text-decoration:none}
.hero{padding:80px 6vw}.eyebrow{font-size:12px;font-weight:700;color:#4f8ff7;text-transform:uppercase;letter-spacing:1px}
.hero h1{font-size:clamp(32px,5vw,56px);max-width:760px;margin:12px 0;letter-spacing:-2px;line-height:1.08}
.hero p{color:#5a6879;max-width:520px;font-size:17px}.cta{display:inline-block;margin-top:18px;padding:12px 22px;border-radius:10px;background:#4f8ff7;color:#fff;text-decoration:none;font-weight:700}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;padding:0 6vw 70px}
.cards article{padding:22px;border-radius:14px;background:#fff;border:1px solid #e1e6ef}.cards h3{margin:0 0 6px}
footer{padding:24px 6vw;border-top:1px solid #e1e6ef;color:#8592a3}
`;
const FORM_HTML = `<!DOCTYPE html>
<html lang="ru"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Форма</title><link rel="stylesheet" href="style.css"></head><body>
<form id="form"><h1>Обратная связь</h1>
<label for="name">Имя</label><input id="name" required minlength="2">
<label for="email">E-mail</label><input id="email" type="email" required>
<label for="msg">Сообщение</label><textarea id="msg" rows="4" required></textarea>
<button type="submit">Отправить</button><p id="out" role="status"></p></form>
<script src="script.js"></script></body></html>`;
const FORM_CSS = `*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#eef1f6;font-family:system-ui,sans-serif}
form{width:min(440px,92vw);padding:28px;border-radius:16px;background:#fff;border:1px solid #d6dde8}
h1{margin:0 0 18px;font-size:23px}label{display:block;margin:12px 0 5px;font-size:12px;font-weight:650;color:#5a6879}
input,textarea{width:100%;padding:10px;border:1px solid #d6dde8;border-radius:8px;font:inherit}
button{width:100%;margin-top:18px;padding:12px;border:0;border-radius:9px;background:#4f8ff7;color:#fff;font-weight:700;cursor:pointer}
#out{font-size:13px;color:#17805a}
`;
const FORM_JS = `document.querySelector('#form').addEventListener('submit', e => {
  e.preventDefault();
  document.querySelector('#out').textContent = 'Спасибо! Форма отправлена.';
  console.log('Отправлено', new FormData(e.target));
});
`;
const THREE_HTML = `<!DOCTYPE html>
<html lang="ru"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>CSS 3D куб</title><link rel="stylesheet" href="style.css"></head><body>
<div class="scene"><div class="cube"><div class="f front">1</div><div class="f back">2</div><div class="f right">3</div>
<div class="f left">4</div><div class="f top">5</div><div class="f bottom">6</div></div></div>
<p>Поворачивайте куб в редакторе: меняйте размеры, цвета и скорость.</p></body></html>`;
const THREE_CSS = `*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0e1116;color:#9aa8ba;font-family:system-ui,sans-serif}
.scene{width:180px;height:180px;perspective:600px;margin-top:60px}
.cube{width:100%;height:100%;position:relative;transform-style:preserve-3d;animation:spin 9s linear infinite}
.f{position:absolute;width:180px;height:180px;border:2px solid #4f8ff7;background:rgba(79,143,247,.12);display:grid;place-items:center;font-size:36px;color:#4f8ff7}
.front{transform:translateZ(90px)}.back{transform:rotateY(180deg) translateZ(90px)}
.right{transform:rotateY(90deg) translateZ(90px)}.left{transform:rotateY(-90deg) translateZ(90px)}
.top{transform:rotateX(90deg) translateZ(90px)}.bottom{transform:rotateX(-90deg) translateZ(90px)}
@keyframes spin{to{transform:rotateX(360deg) rotateY(720deg)}}
p{margin-top:80px;font-size:13px}
@media (prefers-reduced-motion: reduce){.cube{animation:none}}
`;
const CANVAS_HTML = `<!DOCTYPE html>
<html lang="ru"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Canvas</title><link rel="stylesheet" href="style.css"></head><body>
<canvas id="c" width="640" height="400"></canvas><script src="script.js"></script></body></html>`;
const CANVAS_CSS = `body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0e1116}
canvas{border-radius:14px;border:1px solid #2a3341;max-width:92vw}
`;
const CANVAS_JS = `const c = document.querySelector('#c'), x = c.getContext('2d');
let t = 0;
function frame(){
  x.fillStyle = '#0e1116'; x.fillRect(0, 0, c.width, c.height);
  x.fillStyle = '#4f8ff7';
  for (let i = 0; i < 12; i++){
    const a = t / 40 + i / 12 * Math.PI * 2;
    x.beginPath(); x.arc(320 + Math.cos(a) * 140, 200 + Math.sin(a) * 110, 8 + Math.sin(t/20 + i) * 4, 0, 7); x.fill();
  }
  t++; requestAnimationFrame(frame);
}
frame();
`;

export const TEMPLATES = [
  { id: 'blank', name: 'Пустой', desc: 'HTML5-скелет, style.css и script.js', icon: 'file',
    files: () => ({ 'index.html': BASE_HTML, 'style.css': BASE_CSS, 'script.js': BASE_JS }), entry: 'index.html' },
  { id: 'starter', name: 'Демо', desc: 'Готовая карточка со счётчиком кликов', icon: 'code',
    files: () => ({ ...DEFAULT_FILES }), entry: 'index.html' },
  { id: 'landing', name: 'Лендинг', desc: 'Шапка, hero-секция, карточки, футер', icon: 'layers',
    files: () => ({ 'index.html': LANDING_HTML, 'style.css': LANDING_CSS, 'script.js': BASE_JS }), entry: 'index.html' },
  { id: 'form', name: 'Форма', desc: 'Форма с валидацией и обработчиком', icon: 'edit',
    files: () => ({ 'index.html': FORM_HTML, 'style.css': FORM_CSS, 'script.js': FORM_JS }), entry: 'index.html' },
  { id: 'three', name: 'CSS 3D', desc: 'Вращающийся куб на чистом CSS', icon: 'cube',
    files: () => ({ 'index.html': THREE_HTML, 'style.css': THREE_CSS, 'script.js': BASE_JS }), entry: 'index.html' },
  { id: 'canvas', name: 'Canvas', desc: 'Анимация на requestAnimationFrame', icon: 'palette',
    files: () => ({ 'index.html': CANVAS_HTML, 'style.css': CANVAS_CSS, 'script.js': CANVAS_JS }), entry: 'index.html' }
];

function load() {
  try { return JSON.parse(localStorage.getItem(LS) || '[]'); } catch (_) { return []; }
}
function save(list) {
  try { localStorage.setItem(LS, JSON.stringify(list.slice(0, 60))); } catch (e) { toast('Не удалось сохранить список проектов', 'err'); }
}
export function listProjects() { return load().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)); }
export function getActiveId() { return localStorage.getItem(LS_ACTIVE) || ''; }
export function setActiveId(id) { try { localStorage.setItem(LS_ACTIVE, id || ''); } catch (_) { } }
export function getProject(id) { return load().find(p => p.id === id) || null; }

export function snapshotData() {
  const files = {};
  for (const [p, f] of Object.entries(state.files)) files[p] = f.content;
  return {
    projectName: state.projectName, entry: state.entry,
    panes: { ...state.panes }, deps: state.deps, layout: state.layout,
    files, settings: JSON.parse(JSON.stringify(state.settings)),
    progress: state.progress, snapshots: state.snapshots.slice(0, 8)
  };
}
export function makeProject(name, templateId = 'blank') {
  const tpl = TEMPLATES.find(t => t.id === templateId) || TEMPLATES[0];
  const files = tpl.files();
  const rec = {
    id: uid('prj'), name: String(name || 'Новый проект').slice(0, 80),
    template: tpl.id, createdAt: Date.now(), updatedAt: Date.now(),
    data: {
      projectName: String(name || 'Новый проект').slice(0, 80),
      entry: tpl.entry || Object.keys(files)[0],
      panes: { html: 'index.html', css: 'style.css', js: 'script.js' },
      deps: [], layout: 'columns', files, settings: null, progress: {}, snapshots: []
    }
  };
  const list = load(); list.push(rec); save(list);
  emit('projects:changed');
  return rec;
}
export function saveActiveProject() {
  let id = getActiveId();
  const list = load();
  let rec = list.find(p => p.id === id);
  if (!rec) {
    rec = { id: uid('prj'), name: state.projectName || 'Мой проект', template: 'custom',
            createdAt: Date.now(), updatedAt: Date.now(), data: null };
    list.push(rec); save(list); setActiveId(rec.id);
  }
  rec.data = snapshotData();
  rec.name = state.projectName || rec.name;
  rec.updatedAt = Date.now();
  save(list);
  emit('projects:changed');
  return rec;
}
export function openProject(id) {
  const rec = getProject(id); if (!rec) return false;
  setActiveId(id);
  const d = rec.data || {};
  const files = d.files || TEMPLATES[0].files();
  if (d.settings) Object.assign(state.settings, d.settings);
  setProject({
    ...d, files,
    projectName: rec.name, entry: d.entry || Object.keys(files)[0],
    panes: d.panes || { html: 'index.html', css: 'style.css', js: 'script.js' },
    deps: d.deps || [], layout: d.layout || 'columns',
    progress: d.progress || {}, snapshots: d.snapshots || []
  }, rec.name, true);
  state.projectName = rec.name;
  const pn = $('#projectName'); if (pn) pn.value = rec.name;
  emit('project:restoreEditors');
  emit('project:opened', rec);
  ctx.applySettings?.(); ctx.run?.('full'); ctx.analyze?.();
  return true;
}
export function renameProject(id, name) {
  const n = String(name || '').trim().slice(0, 80); if (!n) return false;
  const list = load(); const rec = list.find(p => p.id === id); if (!rec) return false;
  rec.name = n; if (rec.data) rec.data.projectName = n; rec.updatedAt = Date.now();
  save(list); emit('projects:changed');
  if (getActiveId() === id) { state.projectName = n; const pn = $('#projectName'); if (pn) pn.value = n; }
  return true;
}
export function deleteProject(id) {
  const list = load().filter(p => p.id !== id); save(list);
  if (getActiveId() === id) setActiveId('');
  emit('projects:changed'); return true;
}
export function duplicateProject(id) {
  const rec = getProject(id); if (!rec) return null;
  const copy = { ...rec, id: uid('prj'), name: (rec.name + ' — копия').slice(0, 80),
                 createdAt: Date.now(), updatedAt: Date.now(),
                 data: rec.data ? JSON.parse(JSON.stringify(rec.data)) : null };
  if (copy.data) copy.data.projectName = copy.name;
  const list = load(); list.push(copy); save(list);
  emit('projects:changed'); return copy;
}
export function exportProject(id) {
  const rec = getProject(id) || (getActiveId() ? saveActiveProject() : null);
  if (!rec) { toast('Нет проекта для экспорта', 'warn'); return; }
  const payload = { format: 'runlet-project', version: 1, exportedAt: Date.now(),
                    project: { name: rec.name, template: rec.template, data: rec.data || snapshotData() } };
  download(`${rec.name.replace(/[^\w-]/g, '_') || 'project'}.runlet.json`, JSON.stringify(payload, null, 2), 'application/json');
  toast('Проект экспортирован в JSON', 'ok');
}
export function exportAllProjects() {
  const payload = { format: 'runlet-backup', version: 1, exportedAt: Date.now(), projects: load() };
  download('runlet-projects.json', JSON.stringify(payload, null, 2), 'application/json');
  toast('Все проекты экспортированы', 'ok');
}
export async function importProjectFile(file) {
  const text = await file.text();
  let payload;
  try { payload = JSON.parse(text); } catch (_) { toast('Это не JSON-файл проекта', 'err'); return false; }
  const list = load();
  if (payload.format === 'runlet-backup' && Array.isArray(payload.projects)) {
    for (const p of payload.projects.slice(0, 60)) {
      if (!p || !p.id || typeof p.name !== 'string') continue;
      list.push({ ...p, id: uid('prj'), name: p.name.slice(0, 80) });
    }
    save(list); emit('projects:changed'); toast(`Импортировано проектов: ${payload.projects.length}`, 'ok'); return true;
  }
  if (payload.format === 'runlet-project' && payload.project) {
    const p = payload.project;
    const rec = { id: uid('prj'), name: String(p.name || 'Импорт').slice(0, 80), template: p.template || 'custom',
                  createdAt: Date.now(), updatedAt: Date.now(), data: p.data || null };
    list.push(rec); save(list); emit('projects:changed');
    toast('Проект импортирован — откройте его из списка', 'ok'); return true;
  }
  // Fallback: raw project JSON from older versions
  if (payload.files) {
    importProjectJSON(text);
    const rec = saveActiveProject();
    emit('projects:changed');
    toast('Проект импортирован как «' + rec.name + '»', 'ok'); return true;
  }
  toast('Неизвестный формат файла', 'err'); return false;
}
export function ensureSeed() {
  if (load().length) return;
  makeProject('Мой первый сайт', 'starter');
  setActiveId('');
}
export function renderProjectRows(host, onOpen) {
  host.innerHTML = '';
  const list = listProjects();
  if (!list.length) {
    host.appendChild(Object.assign(document.createElement('div'),
      { className: 'empty-note', textContent: 'Проектов пока нет. Создайте первый слева.' }));
    return;
  }
  for (const rec of list) {
    const files = rec.data?.files ? Object.keys(rec.data.files).length : 0;
    const tpl = TEMPLATES.find(t => t.id === rec.template);
    const row = document.createElement('div');
    row.className = 'project-row';
    row.innerHTML = `<div class="pr-ico">${icon(tpl?.icon || 'code', 17)}</div>
      <div class="grow"><b>${esc(rec.name)}</b><div class="project-meta">${files} файл(ов) · ${new Date(rec.updatedAt || rec.createdAt).toLocaleString('ru-RU')}</div></div>
      <div class="project-actions">
        <button class="mini-btn" data-act="open" title="Открыть">${icon('arrowRight', 13)}</button>
        <button class="mini-btn" data-act="rename" title="Переименовать">${icon('edit', 13)}</button>
        <button class="mini-btn" data-act="copy" title="Дублировать">${icon('copy', 13)}</button>
        <button class="mini-btn" data-act="export" title="Экспорт">${icon('download', 13)}</button>
        <button class="mini-btn" data-act="delete" title="Удалить">${icon('trash', 13)}</button>
      </div>`;
    row.querySelector('[data-act="open"]').onclick = e => { e.stopPropagation(); onOpen(rec.id); };
    row.querySelector('[data-act="rename"]').onclick = e => {
      e.stopPropagation();
      ctx.modal({ title: 'Переименовать проект', narrow: true,
        body: `<div class="field"><label>Имя</label><input id="prjRename" value="${esc(rec.name)}" maxlength="80"></div>`,
        okText: 'Сохранить',
        onOk: root => {
          const name = root.querySelector('#prjRename').value.trim();
          if (!name) return false;
          renameProject(rec.id, name); renderProjectRows(host, onOpen);
        } });
    };
    row.querySelector('[data-act="copy"]').onclick = e => { e.stopPropagation(); duplicateProject(rec.id); renderProjectRows(host, onOpen); };
    row.querySelector('[data-act="export"]').onclick = e => { e.stopPropagation(); exportProject(rec.id); };
    row.querySelector('[data-act="delete"]').onclick = e => {
      e.stopPropagation();
      ctx.modal({ title: 'Удалить проект?', narrow: true, danger: true, okText: 'Удалить',
        body: `<p>Проект «${esc(rec.name)}» будет удалён из списка. Это действие нельзя отменить.</p>`,
        onOk: () => { deleteProject(rec.id); renderProjectRows(host, onOpen); } });
    };
    row.onclick = () => onOpen(rec.id);
    host.appendChild(row);
  }
}

export function initProjects() {
  ensureSeed();
  on('saved', () => saveActiveProject());
  on('files:changed', debounce(() => { if (!state.readOnly) saveActiveProject(); }, 1200));
  on('project:rename', () => saveActiveProject());
}
