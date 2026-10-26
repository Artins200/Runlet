/* Virtual FS UI: tree, search, uploads, ZIP, libraries, assets, versions, share. */
import { state, ctx, $, $$, el, esc, on, emit, toast, download, copy, fmtBytes, debounce, uid, safeDataSrc } from './core.js';
import { safePathKey } from './state.js';
import {
  read, write, exists, remove, rename, copyFile, listFiles, projectSize,
  isText, isImage, mimeOf, makeSnapshot, restoreSnapshot, diffText,
  projectJSON, importProjectJSON, encodeShare, allTextFiles, paneOf, makeFile
} from './state.js';
import { setPaneFile, getDoc, setDoc, insertText, goto } from './editor.js';
import { CDN_LIBS } from './data.js';
import {
  processImage, placeholderImage, optimizeSvg, faviconFrom, generateSEO,
  generateAltFor, unusedAssets, SVG_ICONS, staticSite, embedCode
} from './tools.js';
import { srcdoc } from './preview.js';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';

let treeFilter = '';
let dragPath = null;

export function initFiles() {
  on('files:changed', renderTree);
  on('project:loaded', renderTree);
  on('project:size', updateSize);
  on('snapshots', () => { });
  $('#fileFilter')?.addEventListener('input', e => { treeFilter = e.target.value.toLowerCase(); renderTree(); });
  $('#projectName')?.addEventListener('change', e => { state.projectName = e.target.value || 'Мой проект'; emit('project:rename'); });
  const search = $('#globalSearch');
  search?.addEventListener('input', debounce(() => doSearch(search.value, $('#searchRegex')?.checked), 260));
  $('#searchRegex')?.addEventListener('change', () => doSearch($('#globalSearch')?.value, $('#searchRegex')?.checked));
  $('#hiddenFileInput')?.addEventListener('change', e => uploadFiles([...e.target.files]));
  $('#hiddenZipInput')?.addEventListener('change', e => { if (e.target.files[0]) importZip(e.target.files[0]); e.target.value = ''; });
  $('#hiddenHtmlInput')?.addEventListener('change', e => { if (e.target.files[0]) importSingleHtml(e.target.files[0]); e.target.value = ''; });
  const ws = $('#workspace');
  ws?.addEventListener('dragover', e => { e.preventDefault(); ws.style.outline = '2px dashed var(--accent)'; });
  ws?.addEventListener('dragleave', e => { if (!ws.contains(e.relatedTarget)) ws.style.outline = ''; });
  ws?.addEventListener('drop', e => {
    e.preventDefault(); ws.style.outline = '';
    if (e.dataTransfer?.files?.length) uploadFiles([...e.dataTransfer.files]);
  });
  renderTree(); renderLibs(); renderAssets(); updateSize();
}

/* ── file tree ──────────────────────────────────────────────────── */
export function renderTree() {
  const host = $('#fileTree'); if (!host) return;
  host.innerHTML = '';
  const files = listFiles().filter(p => !treeFilter || p.toLowerCase().includes(treeFilter));
  const dirs = new Set();
  for (const p of files) {
    const parts = p.split('/');
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
  }
  const children = parent => {
    const direct = new Set();
    for (const p of files) {
      const rest = parent ? (p.startsWith(parent + '/') ? p.slice(parent.length + 1) : null) : p;
      if (rest == null) continue;
      direct.add(rest.split('/')[0] + (rest.includes('/') ? '/' : ''));
    }
    for (const d of dirs) {
      const rest = parent ? (d.startsWith(parent + '/') ? d.slice(parent.length + 1) : null) : d;
      if (rest && !rest.includes('/')) direct.add(rest + '/');
    }
    return [...direct].sort((a, b) => (b.endsWith('/') - a.endsWith('/')) || a.localeCompare(b));
  };
  const build = (parent, depth) => {
    for (const name of children(parent)) {
      const path = (parent ? parent + '/' : '') + name.replace(/\/$/, '');
      const isDir = name.endsWith('/');
      const f = state.files[path];
      const active = Object.values(state.panes).includes(path);
      const row = el('div', { class: 'tree-row' + (active ? ' active' : ''), draggable: 'true',
                              style: { paddingLeft: (7 + depth * 13) + 'px' }, title: path },
        el('span', { class: 'twist', text: isDir ? '▾' : '' }),
        f && isImage(path) && safeDataSrc(f.content) ?
          el('img', { class: 'tree-thumb', src: safeDataSrc(f.content), alt: '' }) :
          el('span', { class: 'ftype', text: iconFor(path, isDir) }),
        el('span', { class: 'fname', text: name.replace(/\/$/, '') }),
        el('span', { class: 'tree-meta', text: isDir ? '' : fmtBytes(f?.content?.length || 0) }),
        el('span', { class: 'fmenu', text: '⋯' }));
      row.addEventListener('click', e => {
        if (e.target.classList.contains('fmenu')) { e.stopPropagation(); contextMenu(e, path, isDir); return; }
        if (isDir) { row.nextElementSibling?.classList?.toggle('hidden'); return; }
        openFile(path);
      });
      row.addEventListener('contextmenu', e => { e.preventDefault(); contextMenu(e, path, isDir); });
      row.addEventListener('dragstart', e => { dragPath = path; e.dataTransfer.setData('text/plain', path); });
      row.addEventListener('dragover', e => { if (isDir) e.preventDefault(); });
      row.addEventListener('drop', e => {
        e.preventDefault(); e.stopPropagation();
        const src = e.dataTransfer.getData('text/plain') || dragPath;
        if (!src || src === path) return;
        const target = isDir ? path + '/' + src.split('/').pop() : path;
        if (isDir) { rename(src, target); toast(`Перемещено в ${path}/`, 'ok'); renderTree(); }
      });
      host.appendChild(row);
      if (isDir) { const before = host.children.length; build(path, depth + 1); }
    }
  };
  build('', 0);
  if (!files.length) host.appendChild(el('div', { class: 'empty-note', text: 'Файлов нет. Нажмите «＋ файл».' }));
  updateSize();
}
function iconFor(path, isDir) {
  if (isDir) return '📁';
  const e = (path.split('.').pop() || '').toLowerCase();
  return ({ html: '🟠', htm: '🟠', css: '🔵', scss: '🔵', js: '🟡', mjs: '🟡', ts: '🔷',
            json: '🟣', md: '📄', png: '🖼', jpg: '🖼', jpeg: '🖼', gif: '🖼', webp: '🖼',
            svg: '✒', woff2: '🔤', ttf: '🔤', mp3: '🎵', mp4: '🎬', txt: '📄' })[e] || '📄';
}
export function updateSize() {
  const n = $('#projectSize'), s = $('#statusSize');
  const text = `${listFiles().length} файлов · ${fmtBytes(projectSize())}`;
  if (n) n.textContent = text;
  if (s) s.textContent = fmtBytes(projectSize());
}
export function openFile(path) {
  if (!exists(path)) return;
  const f = state.files[path];
  if (!isText(path) || /^data:/.test(f.content)) {
    showAssetPreview(path); return;
  }
  const pane = paneOf(path) || state.activePane;
  setPaneFile(pane, path);
  state.activeFile = path;
  emit('file:open', path);
}
function contextMenu(e, path, isDir) {
  const menu = $('#contextMenu'); if (!menu) return;
  menu.innerHTML = '';
  const items = [
    ['Открыть', () => openFile(path)],
    ['Переименовать', () => renameDialog(path)],
    ['Дублировать', () => { copyFile(path); renderTree(); toast('Файл продублирован', 'ok'); }],
    ['Копировать путь', () => copy(path)],
    ['Найти ссылки', () => findReferences(path)],
    ['Скачать', () => downloadFile(path)],
    ['—', null],
    ['Удалить', () => deleteConfirm(path)]
  ];
  for (const [label, fn] of items) {
    if (!fn) { menu.appendChild(el('hr')); continue; }
    menu.appendChild(el('button', { onclick: () => { menu.classList.remove('show'); fn(); } }, label));
  }
  menu.style.left = Math.min(e.clientX, innerWidth - 210) + 'px';
  menu.style.top = Math.min(e.clientY, innerHeight - 260) + 'px';
  menu.classList.add('show');
  setTimeout(() => document.addEventListener('click', () => menu.classList.remove('show'), { once: true }), 10);
}

/* ── CRUD dialogs ───────────────────────────────────────────────── */
export function newFileDialog(folder = false) {
  ctx.modal({
    title: folder ? 'Новая папка' : 'Новый файл',
    body: `<div class="field"><label>Имя ${folder ? 'папки' : 'файла'}</label><input id="dlgName" value="${folder ? 'new-folder' : 'new-file.html'}" autofocus></div>
           <div class="muted" style="font-size:11px">Можно указать путь: <code class="inline">components/card.html</code></div>`,
    okText: 'Создать',
    onOk: root => {
      const name = root.querySelector('#dlgName').value.trim();
      if (!name) return false;
      const safeName = esc(name.slice(0, 200));
      const path = folder ? name.replace(/\/$/, '') + '/README.md' : name;
      if (exists(path)) { toast('Такой файл уже есть', 'err'); return false; }
      let content = '';
      if (folder) content = '# ' + name.replace(/[\r\n]/g, '') + '\n';
      else if (/\.html$/i.test(path)) content = '<!DOCTYPE html>\n<html lang="ru">\n<head><meta charset="utf-8"><title>' + safeName + '</title></head>\n<body>\n  \n</body>\n</html>';
      else if (/\.css$/i.test(path)) content = '/* ' + name.replace(/\*\//g, '').slice(0, 200) + ' */\n';
      else if (/\.js$/i.test(path)) content = '// ' + name.replace(/[\r\n]/g, '').slice(0, 200) + '\n';
      else if (/\.json$/i.test(path)) content = '{\n  \n}\n';
      write(path, content);
      renderTree(); openFile(path);
      toast(`Создано: ${path}`, 'ok', 'Файлы');
    }
  });
}
export function renameDialog(path) {
  ctx.modal({
    title: 'Переименовать', body: `<div class="field"><label>Новое имя</label><input id="dlgName" value="${esc(path)}"></div>
      <label class="chk"><input type="checkbox" id="dlgUpdateRefs" checked> обновить ссылки в коде</label>`,
    okText: 'Переименовать',
    onOk: root => {
      const to = root.querySelector('#dlgName').value.trim();
      if (!to || to === path) return false;
      if (exists(to)) { toast('Имя занято', 'err'); return false; }
      rename(path, to); renderTree(); toast('Переименовано (+ ссылки обновлены)', 'ok');
    }
  });
}
export function deleteConfirm(path) {
  if (!state.settings.confirmDelete) { remove(path); renderTree(); return; }
  ctx.modal({
    title: 'Удалить файл?', narrow: true,
    body: `<p>Вы уверены, что хотите удалить <code class="inline">${esc(path)}</code>?</p>
           <p class="muted" style="font-size:11px">Это действие можно отменить через снапшоты версий.</p>`,
    okText: 'Удалить', danger: true,
    onOk: () => { makeSnapshot('Перед удалением ' + path); remove(path); renderTree(); toast('Удалено', 'ok'); }
  });
}

/* ── search / replace ───────────────────────────────────────────── */
export function doSearch(query, useRegex = false) {
  const host = $('#searchResults'); if (!host) return [];
  host.innerHTML = '';
  if (!query || query.length < 1) { host.innerHTML = '<div class="empty-note">Введите запрос для поиска по проекту</div>'; return []; }
  let re;
  try { re = useRegex ? new RegExp(query, 'gi') : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'); }
  catch (e) { host.innerHTML = `<div class="empty-note">Ошибка регулярного выражения: ${esc(e.message)}</div>`; return []; }
  const results = [];
  for (const [path, f] of Object.entries(state.files)) {
    if (!isText(path)) continue;
    f.content.split('\n').forEach((line, i) => {
      re.lastIndex = 0;
      if (re.test(line)) {
        results.push({ path, line: i + 1, text: line.trim().slice(0, 160) });
        const row = el('div', { class: 'search-hit' },
          el('b', { text: `${path}:${i + 1}` }),
          el('code', { text: line.trim().slice(0, 160) }));
        row.addEventListener('click', () => {
          const pane = paneOf(path) || state.activePane;
          if (state.panes[pane] !== path) setPaneFile(pane, path);
          goto(pane, i + 1, 1);
        });
        host.appendChild(row);
      }
    });
  }
  if (!results.length) host.innerHTML = '<div class="empty-note">Ничего не найдено</div>';
  return results;
}
export function replaceAllInProject() {
  const q = $('#globalSearch')?.value || '', r = $('#globalReplace')?.value ?? '';
  if (!q) { toast('Введите строку поиска', 'warn'); return 0; }
  const useRegex = $('#searchRegex')?.checked;
  let re;
  try { re = useRegex ? new RegExp(q, 'g') : new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'); }
  catch (e) { toast('Ошибка regex: ' + e.message, 'err'); return 0; }
  let n = 0;
  for (const [path, f] of Object.entries(state.files)) {
    if (!isText(path)) continue;
    const out = f.content.replace(re, r);
    if (out !== f.content) {
      n += (f.content.match(re) || []).length;
      const pane = Object.entries(state.panes).find(([, p]) => p === path)?.[0];
      if (pane) setDoc(out, pane); else write(path, out);
    }
  }
  toast(`Заменено вхождений: ${n}`, 'ok', 'Поиск');
  doSearch(q, useRegex);
  return n;
}
export function findReferences(path) {
  const name = path.split('/').pop();
  const results = [];
  for (const [p, f] of Object.entries(state.files)) {
    if (!isText(p)) continue;
    f.content.split('\n').forEach((l, i) => {
      if (l.includes(name) || l.includes(path)) results.push(`${p}:${i + 1}  ${l.trim().slice(0, 90)}`);
    });
  }
  ctx.modal({ title: `Ссылки на ${path}`,
    body: results.length ? `<pre style="font:11px var(--mono);white-space:pre-wrap">${esc(results.join('\n'))}</pre>` : '<p class="muted">Ссылок не найдено — возможно, файл не используется.</p>',
    okText: 'Закрыть' });
  return results;
}

/* ── uploads / downloads / ZIP ──────────────────────────────────── */
export async function uploadFiles(fileList) {
  let n = 0;
  for (const file of fileList) {
    const path = safePathKey(file.webkitRelativePath || file.name);
    if (!path) { toast('Пропущен файл с небезопасным именем: ' + String(file.name).slice(0, 80), 'warn'); continue; }
    let content;
    if (/\.(png|jpe?g|gif|webp|ico|woff2?|ttf|otf|mp3|wav|mp4|webm)$/i.test(path)) {
      content = await new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(file); });
    } else content = await file.text();
    write(path, content);
    n++;
  }
  renderTree(); renderAssets();
  toast(`Загружено файлов: ${n}`, 'ok', 'Файлы');
}
export function downloadFile(path) {
  const c = read(path);
  if (/^data:/.test(c)) { download(path.split('/').pop(), dataUriToBlob(c), mimeOf(path)); }
  else download(path.split('/').pop(), c, mimeOf(path));
  toast('Скачано: ' + path, 'ok');
}
function dataUriToBlob(uri) {
  if (!safeDataSrc(uri)) throw new Error('небезопасный data URI');
  const [meta, payload] = [uri.slice(5, uri.indexOf(',')), uri.slice(uri.indexOf(',') + 1)];
  if (/;base64/i.test(meta)) {
    const bin = atob(payload), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: meta.split(';')[0] });
  }
  return new Blob([decodeURIComponent(payload)], { type: meta.split(';')[0] });
}
export async function exportZip(opts = {}) {
  const data = {};
  for (const [p, f] of Object.entries(state.files)) {
    if (opts.assetsOnly && !/\.(png|jpe?g|gif|webp|svg|woff2?|ttf|mp3|mp4)$/i.test(p)) continue;
    data[p] = strToU8(f.content);
  }
  data['runlet.project.json'] = strToU8(projectJSON());
  const zipped = zipSync(data, { level: 6 });
  download((state.projectName || 'runlet').replace(/[^\w-]/g, '_') + '.zip', new Blob([zipped], { type: 'application/zip' }), 'application/zip');
  toast(`Экспортировано ${Object.keys(data).length} файлов в ZIP`, 'ok');
}
export async function importZip(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  const entries = unzipSync(buf);
  let count = 0;
  for (const [name, data] of Object.entries(entries)) {
    const path = safePathKey(name);
    if (!path) continue;                       // blocks zip-slip (../) and __proto__
    if (name.endsWith('/') || name === 'runlet.project.json') continue;
    let content;
    try { content = strFromU8(data); } catch (e) { continue; }
    if (/\.(png|jpe?g|gif|webp|woff2?|mp3|mp4)$/i.test(name)) {
      let bin = ''; for (const b of data) bin += String.fromCharCode(b);
      content = `data:${mimeOf(name)};base64,` + btoa(bin);
    }
    write(path, content); count++;
  }
  renderTree(); renderAssets();
  emit('project:restoreEditors');
  toast(`Импортировано файлов из ZIP: ${count}`, 'ok', 'Проект');
}
export async function importSingleHtml(file) {
  const html = await file.text();
  const styles = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map(m => m[1]).join('\n');
  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]).join('\n');
  let rest = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/gi, '');
  if (!/<link[^>]+stylesheet/i.test(rest) && styles) rest = rest.replace('</head>', `<link rel="stylesheet" href="style.css">\n</head>`);
  if (!/<script[^>]+src=/i.test(rest) && scripts) rest = rest.replace('</body>', `<script src="script.js"></script>\n</body>`);
  write('index.html', rest);
  if (styles) write('style.css', styles.trim());
  if (scripts) write('script.js', scripts.trim());
  state.entry = 'index.html';
  state.panes = { html: 'index.html', css: 'style.css', js: 'script.js' };
  renderTree(); emit('project:restoreEditors');
  toast('HTML разделён на 3 панели', 'ok', 'Импорт');
}
export function exportSingleHtml() {
  download('index.html', srcdoc(), 'text/html');
  toast('Проект собран в один HTML-файл', 'ok');
}
export function exportStaticSite() {
  const files = staticSite();
  download('index.html', files['index.html'], 'text/html');
  download('README.md', files['README.md'], 'text/markdown');
  toast('Статический сайт экспортирован', 'ok');
}
export function importFromUrl() {
  ctx.modal({
    title: 'Импорт по URL',
    body: `<div class="field"><label>Ссылка на HTML/JS/CSS/JSON или raw GitHub</label><input id="dlgUrl" placeholder="https://raw.githubusercontent.com/..."></div>
           <p class="muted" style="font-size:11px">Работает с ресурсами, разрешающими CORS. В Electron ограничений нет.</p>`,
    okText: 'Загрузить',
    onOk: async root => {
      const url = root.querySelector('#dlgUrl').value.trim();
      if (!url) return false;
      let u;
      try { u = new URL(url); } catch (_) { toast('Некорректный URL', 'err'); return false; }
      if (u.protocol !== 'https:' || u.username || u.password || url.length > 2000 ||
          /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[::1\])/i.test(u.hostname)) {
        toast('Разрешены только публичные HTTPS-адреса', 'err'); return false;
      }
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15000);
        const res = await fetch(u.href, { credentials: 'omit', referrerPolicy: 'no-referrer', signal: controller.signal });
        clearTimeout(timer);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        if (+res.headers.get('content-length') > 4 * 1024 * 1024) throw new Error('файл слишком большой');
        const text = (await res.text()).slice(0, 4 * 1024 * 1024);
        const name = (u.pathname.split('/').pop() || 'imported.html').replace(/[^\w.-]/g, '').slice(0, 120) || 'imported.html';
        if (/\.html?$/i.test(name)) await importSingleHtml(new File([text], name, { type: 'text/html' }));
        else { write(name, text); renderTree(); }
        toast('Импортировано: ' + name, 'ok');
      } catch (e) { toast('Не удалось загрузить: ' + e.message + ' (CORS?)', 'err'); }
    }
  });
}

/* ── libraries ──────────────────────────────────────────────────── */
export function renderLibs() {
  const host = $('#libsPanel'); if (!host) return;
  host.innerHTML = '';
  host.appendChild(el('div', { class: 'rowflex mb8' },
    el('input', { id: 'libSearch', placeholder: 'Поиск библиотеки…', style: { flex: '1', height: '29px', borderRadius: '9px', border: '1px solid var(--border)', background: 'var(--code-bg)', padding: '0 9px' } })));
  const list = el('div', { class: 'list-rows', id: 'libList' });
  host.appendChild(list);
  const draw = q => {
    list.innerHTML = '';
    for (const lib of CDN_LIBS.filter(l => !q || (l.name + l.cat + l.desc).toLowerCase().includes(q.toLowerCase()))) {
      const dep = state.deps.find(d => (typeof d === 'string' ? d : d.id) === lib.id);
      const row = el('div', { class: 'list-row' },
        el('div', { class: 'grow' }, el('b', { text: lib.name }), el('small', { text: lib.desc })),
        el('select', { class: 'mini-select', title: 'Версия' },
          ...lib.versions.map(v => el('option', { value: v, selected: (typeof dep === 'object' && dep.version === v) ? 'selected' : null, text: v }))),
        el('button', { class: 'mini-btn ' + (dep ? 'active' : ''), text: dep ? '✓' : '+' }));
      const sel = row.querySelector('select'), btn = row.querySelector('button');
      btn.classList.toggle('active', !!dep);
      btn.addEventListener('click', () => {
        if (dep) state.deps = state.deps.filter(d => (typeof d === 'string' ? d : d.id) !== lib.id);
        else { state.deps.push({ id: lib.id, version: sel.value, name: lib.name, enabled: true }); }
        emit('deps:changed'); draw(q);
        toast(`${dep ? 'Отключена' : 'Подключена'} библиотека ${lib.name}`, 'ok');
      });
      sel.addEventListener('change', () => {
        const d = state.deps.find(d => (typeof d === 'string' ? d : d.id) === lib.id);
        if (typeof d === 'object') { d.version = sel.value; emit('deps:changed'); }
      });
      list.appendChild(row);
    }
    if (!list.children.length) list.appendChild(el('div', { class: 'empty-note', text: 'Ничего не найдено' }));
  };
  draw('');
  host.querySelector('#libSearch').addEventListener('input', e => draw(e.target.value));
  host.appendChild(el('div', { class: 'mt8 muted', style: { fontSize: '10px' } },
    `Подключено: ${state.deps.length}. Дубли проверяются автоматически.`));
}

/* ── assets ─────────────────────────────────────────────────────── */
export function renderAssets() {
  const host = $('#assetsPanel'); if (!host) return;
  host.innerHTML = '';
  const assets = listFiles().filter(p => /\.(png|jpe?g|gif|webp|svg|ico|woff2?|ttf|otf|mp3|wav|mp4|webm)$/i.test(p));
  const actions = el('div', { class: 'rowflex mb8' },
    el('button', { class: 'mini-btn', text: '＋ placeholder', onclick: () => {
      const url = placeholderImage(640, 360, randomAccent(), 'Runlet placeholder');
      const p = `assets/placeholder-${Date.now().toString(36)}.png`;
      write(p, url); renderTree(); renderAssets(); toast('Placeholder создан: ' + p, 'ok');
    } }),
    el('button', { class: 'mini-btn', text: '＋ SVG', onclick: () => {
      const p = `assets/icon-${Date.now().toString(36)}.svg`;
      write(p, SVG_ICONS.star.replace('currentColor', '#7c6cf6')); renderTree(); renderAssets();
    } }),
    el('button', { class: 'mini-btn', text: '＋ favicon', onclick: () => {
      const p = 'favicon.png'; write(p, faviconFrom(state.settings.accent));
      const html = read(state.entry).replace('</head>', `<link rel="icon" href="${p}">\n</head>`);
      write(state.entry, html); renderTree(); renderAssets(); toast('Favicon создан и подключён', 'ok');
    } }),
    el('button', { class: 'mini-btn', text: 'ZIP ассетов', onclick: () => exportZip({ assetsOnly: true }) }),
    el('button', { class: 'mini-btn', text: 'Очистить лишние', onclick: cleanupAssets }));
  host.appendChild(actions);
  if (!assets.length) host.appendChild(el('div', { class: 'empty-note', text: 'Ассетов пока нет. Перетащите файлы в окно редактора.' }));
  const grid = el('div', { class: 'grid-cards' });
  for (const p of assets) {
    const f = state.files[p];
    const tile = el('div', { class: 'tile' });
    const isImg = isImage(p);
    const src = isImg ? safeDataSrc(f.content) : '';
    tile.innerHTML = `<div class="tile-ico">${src ?
      `<img src="${esc(src)}" style="width:100%;height:64px;object-fit:contain;border-radius:8px">` :
      (/\.mp3|wav/.test(p) ? '🎵' : /\.mp4|webm/.test(p) ? '🎬' : '🔤')}</div>
      <b>${esc(p.split('/').pop())}</b><small>${fmtBytes(f.content.length)} · ${esc(mimeOf(p))}</small>`;
    const row = el('div', { class: 'rowflex mt8' },
      el('button', { class: 'mini-btn', text: 'Вставить', onclick: () => insertAsset(p) }),
      el('button', { class: 'mini-btn', text: '⋮', onclick: ev => contextMenu(ev, p, false) }));
    tile.appendChild(row);
    grid.appendChild(tile);
  }
  host.appendChild(grid);
}
function randomAccent() { return state.settings.accent || '#7c6cf6'; }
export function insertAsset(path) {
  const ext = (path.split('.').pop() || '').toLowerCase();
  let code = '';
  if (isImage(path)) code = `<img src="${path}" alt="${generateAltFor(path)}" loading="lazy">`;
  else if (/\.(woff2?|ttf|otf)$/.test(path)) code = `@font-face {\n  font-family: '${path.split('/').pop().split('.')[0]}';\n  src: url('${path}') format('woff2');\n  font-display: swap;\n}`;
  else if (/\.mp3|wav/.test(path)) code = `<audio controls src="${path}"></audio>`;
  else if (/\.mp4|webm/.test(path)) code = `<video controls src="${path}"></video>`;
  else if (/\.svg$/.test(path)) code = read(path);
  insertText(code, isImage(path) || /\.(mp3|mp4|wav|webm|svg)$/.test(path) ? 'html' : 'css');
  toast('Ссылка на ассет вставлена', 'ok');
}
export function cleanupAssets() {
  const unused = unusedAssets();
  if (!unused.length) { toast('Неиспользуемых ассетов нет', 'ok'); return; }
  ctx.modal({ title: 'Удалить неиспользуемые ассеты?', narrow: true,
    body: `<p>Найдено: ${unused.length}</p><pre style="font:11px var(--mono)">${esc(unused.join('\n'))}</pre>`,
    okText: 'Удалить', danger: true,
    onOk: () => { for (const p of unused) remove(p, { silent: true }); renderTree(); renderAssets(); toast(`Удалено ${unused.length} ассетов`, 'ok'); } });
}
export async function showAssetPreview(path) {
  const f = state.files[path], c = f.content;
  const isImg = /^data:image/.test(c) || /\.svg$/i.test(path);
  let inner = '';
  const src = safeDataSrc(c);
  if (isImg && src) inner = `<img src="${esc(src)}" style="max-width:100%;max-height:50vh;border-radius:14px;background:repeating-conic-gradient(#222 0 25%,#333 0 50%) 50%/20px 20px">`;
  else if (/\.mp3|wav/.test(path) && src) inner = `<audio controls src="${esc(src)}" style="width:100%"></audio>`;
  else if (/\.mp4|webm/.test(path) && src) inner = `<video controls src="${esc(src)}" style="max-width:100%;max-height:50vh;border-radius:14px"></video>`;
  else inner = `<p class="muted">Бинарный файл: ${esc(mimeOf(path))}</p>`;
  ctx.modal({ title: path, wide: false,
    body: `${inner}<div class="field-row mt8">
      <div class="field"><label>Размер</label><input value="${fmtBytes(c.length)}" readonly></div>
      <div class="field"><label>Тип</label><input value="${esc(mimeOf(path))}" readonly></div>
      <div class="field"><label>Ширина (ресайз)</label><input id="imgW" type="number" value="800"></div>
    </div>
    <div class="rowflex"><button class="mini-btn" id="doConvert">Конвертировать WebP</button>
    <button class="mini-btn" id="doResize">Изменить размер</button>
    <button class="mini-btn" id="doPoster">Кадр-постер</button></div>`,
    okText: 'Закрыть',
    onMount: root => {
      root.querySelector('#doConvert')?.addEventListener('click', async () => {
        if (!isImg) return toast('Доступно только для изображений', 'warn');
        const out = await processImage(c, { format: 'image/webp', quality: .85 });
        const p = path.replace(/\.[^.]+$/, '.webp'); write(p, out); renderTree(); renderAssets();
        toast('Сконвертировано в ' + p, 'ok');
      });
      root.querySelector('#doResize')?.addEventListener('click', async () => {
        const w = +root.querySelector('#imgW').value || 800;
        const out = await processImage(c, { width: w, format: mimeOf(path) });
        write(path, out); renderTree(); toast(`Размер изменён: ${w}px`, 'ok');
      });
      root.querySelector('#doPoster')?.addEventListener('click', () => {
        const url = placeholderImage(640, 360, state.settings.accent, 'Poster');
        write('assets/poster.png', url); renderTree(); toast('Постер создан', 'ok');
      });
    }
  });
}

/* ── versions / snapshots ───────────────────────────────────────── */
export function snapshotDialog() {
  const snap = makeSnapshot('Версия ' + new Date().toLocaleTimeString('ru-RU'));
  toast('Снапшот создан', 'ok', 'Версии');
  versionsDialog(snap.id);
}
export function versionsDialog(selected = null) {
  const rows = state.snapshots.map(s => `<div class="list-row">
    <div class="grow"><b>${esc(s.label)}</b><small>${new Date(s.at).toLocaleString('ru-RU')} · ${Object.keys(s.files).length} файлов</small></div>
    <button class="mini-btn" data-restore="${s.id}">Восстановить</button>
    <button class="mini-btn" data-diff="${s.id}">Diff</button>
    <button class="mini-btn" data-del="${s.id}">✕</button></div>`).join('');
  ctx.modal({ title: 'История версий', wide: true,
    body: `<div class="rowflex mb8"><button class="mini-btn" id="makeSnap">＋ Создать снапшот</button>
      <span class="muted" style="font-size:11px">Хранится до 25 последних версий</span></div><div class="list-rows">${rows || '<div class="empty-note">Снапшотов пока нет</div>'}</div>
      <div id="diffBox" class="mt8"></div>`,
    okText: 'Закрыть',
    onMount: root => {
      root.querySelector('#makeSnap').addEventListener('click', () => { makeSnapshot('Вручную'); ctx.closeModal(); snapshotDialog(); });
      root.querySelectorAll('[data-restore]').forEach(b => b.addEventListener('click', () => {
        restoreSnapshot(b.dataset.restore); ctx.closeModal(); toast('Версия восстановлена', 'ok');
      }));
      root.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => {
        state.snapshots = state.snapshots.filter(s => s.id !== b.dataset.del); b.closest('.list-row').remove();
      }));
      root.querySelectorAll('[data-diff]').forEach(b => b.addEventListener('click', () => {
        const s = state.snapshots.find(x => x.id === b.dataset.diff);
        if (!s) return;
        const cur = allTextFiles();
        const lines = [];
        for (const [p, code] of Object.entries(cur)) {
          const old = s.files[p] || '';
          if (old === code) continue;
          lines.push(`<h4 style="font-size:11px;margin:10px 0 4px">${esc(p)}</h4>`);
          for (const d of diffText(old, code).slice(0, 60)) {
            const color = d.t === '+' ? 'var(--ok)' : d.t === '-' ? 'var(--err)' : 'var(--dim)';
            lines.push(`<div style="font:10px var(--mono);color:${color};white-space:pre-wrap">${d.t} ${esc(d.v)}</div>`);
          }
        }
        root.querySelector('#diffBox').innerHTML = `<div style="max-height:260px;overflow:auto;border:1px solid var(--border);border-radius:12px;padding:10px">${lines.join('') || '<p class="muted">Изменений нет</p>'}</div>`;
      }));
    } });
}

/* ── sharing ────────────────────────────────────────────────────── */
export async function shareDialog() {
  const code = await encodeShare({ readOnly: false });
  const url = location.href.split('#')[0] + '#p=' + code;
  ctx.modal({ title: 'Поделиться проектом', wide: true,
    body: `<div class="field"><label>Ссылка на проект (Read-only)</label><input id="shareUrl" value="${esc(url)}" readonly></div>
      <div class="field-row">
        <div class="field"><label>Режим</label><select id="shareMode"><option value="ro">Только чтение</option><option value="rw">Редактирование</option></select></div>
        <div class="field"><label>Пароль (необязательно)</label><input id="sharePass" placeholder="без пароля"></div>
        <div class="field"><label>Тема embed</label><select id="shareTheme"><option value="dark">dark</option><option value="light">light</option></select></div>
        <div class="field"><label>Высота embed</label><input id="shareH" type="number" value="520"></div>
      </div>
      <div class="field"><label>Embed-код</label><textarea id="embedCode" rows="3" readonly>${esc(embedCode({ height: 520 }))}</textarea></div>
      <div class="tabs-line" id="shareActions">
        <button data-act="copyLink">📋 Копировать ссылку</button><button data-act="copyEmbed">📋 Embed</button>
        <button data-act="gist">GitHub Gist</button><button data-act="pen">CodePen</button>
        <button data-act="fiddle">JSFiddle</button><button data-act="stackblitz">StackBlitz</button>
        <button data-act="email">✉ Пригласить</button><button data-act="qr">QR-код</button>
      </div><div id="shareExtra" class="mt8"></div>`,
    okText: 'Готово',
    onMount: root => {
      const link = root.querySelector('#shareUrl');
      const rebuild = async () => {
        const mode = root.querySelector('#shareMode').value;
        const pass = root.querySelector('#sharePass').value;
        const theme = root.querySelector('#shareTheme').value;
        const h = +root.querySelector('#shareH').value || 520;
        const c = await encodeShare({ readOnly: mode === 'ro', password: pass || null });
        link.value = location.href.split('#')[0] + '#p=' + c;
        root.querySelector('#embedCode').value = embedCode({ theme, height: h });
      };
      root.querySelectorAll('#shareMode,#sharePass,#shareTheme,#shareH').forEach(x => x.addEventListener('change', rebuild));
      root.querySelectorAll('#shareActions button').forEach(b => b.addEventListener('click', async () => {
        const act = b.dataset.act;
        if (act === 'copyLink') { await copy(link.value); toast('Ссылка скопирована', 'ok'); }
        if (act === 'copyEmbed') { await copy(root.querySelector('#embedCode').value); toast('Embed-код скопирован', 'ok'); }
        if (act === 'gist') {
          const files = Object.fromEntries(Object.entries(allTextFiles()).map(([k, v]) => [k, { content: v }]));
          ctx.modal({ title: 'GitHub Gist', body: `<p class="muted">Скопируйте JSON и создайте gist на gist.github.com (в Electron можно через <code class="inline">gh gist create</code>).</p><textarea rows="8" style="width:100%;font:11px var(--mono)">${esc(JSON.stringify({ description: state.projectName, public: false, files }, null, 2))}</textarea>`, okText: 'Закрыть' });
        }
        if (act === 'pen') postForm('https://codepen.io/pen/define', { data: JSON.stringify({ title: state.projectName, html: read('index.html'), css: listFiles().filter(p => /\.css$/.test(p)).map(read).join('\n'), js: listFiles().filter(p => /\.js$/.test(p)).map(read).join('\n') }) });
        if (act === 'fiddle') postForm('https://jsfiddle.net/api/post/library/pure/', { title: state.projectName, html: read('index.html'), css: listFiles().filter(p => /\.css$/.test(p)).map(read).join('\n'), js: listFiles().filter(p => /\.js$/.test(p)).map(read).join('\n') });
        if (act === 'stackblitz') postForm('https://stackblitz.com/run', { project: JSON.stringify({ title: state.projectName, files: Object.fromEntries(Object.entries(allTextFiles()).map(([k, v]) => ['/' + k, v])), template: 'javascript' }) });
        if (act === 'email') location.href = 'mailto:?subject=' + encodeURIComponent('Проект Runlet: ' + state.projectName) + '&body=' + encodeURIComponent(link.value);
        if (act === 'qr') root.querySelector('#shareExtra').innerHTML = `<div class="empty-note">QR-код можно сгенерировать из скопированной ссылки.<br>Длина ссылки: ${link.value.length} символов.</div>`;
      }));
    } });
}
function postForm(url, data) {
  const f = document.createElement('form');
  f.method = 'POST'; f.action = url; f.target = '_blank'; f.style.display = 'none';
  for (const [k, v] of Object.entries(data)) {
    const i = document.createElement('textarea'); i.name = k; i.value = v; f.appendChild(i);
  }
  document.body.appendChild(f); f.submit(); setTimeout(() => f.remove(), 1500);
  toast('Открыто в новой вкладке', 'ok');
}
