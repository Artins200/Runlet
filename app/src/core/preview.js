/* Live preview: srcdoc builder, virtual path resolution, sandbox bridge, devices. */
import * as acorn from 'acorn';
import { state, ctx, $, $$, on, emit, toast, debounce, esc, download, copy } from './core.js';
import { read, write, exists, listFiles, mimeOf, isText, allTextFiles, paneOf } from './state.js';
import { CDN_LIBS, DEVICES } from './data.js';
import { bridgeSource } from './bridge.js';
import { getDoc, goto } from './editor.js';

let frame, stage, wrap;
let currentSrcdoc = '';
let lastHash = { html: '', css: '', js: '' };
let fid = 0;
let currentFid = 'rl0';
let runCount = 0;
const requests = new Map();
let reqId = 0;
let formState = null;
let measureStart = null;

let lastSandboxValue = null;
export function applySandbox() {
  if (!frame) return;
  const p = state.settings.sandboxPermissions || {};
  const tokens = ['allow-scripts'];            // never allow-same-origin
  if (p.forms) tokens.push('allow-forms');
  if (p.popups) tokens.push('allow-popups');
  if (p.modals) tokens.push('allow-modals');
  if (p.downloads) tokens.push('allow-downloads');
  if (p.pointerLock) tokens.push('allow-pointer-lock');
  if (p.orientationLock) tokens.push('allow-orientation-lock');
  const value = tokens.join(' ');
  const changed = lastSandboxValue !== null && lastSandboxValue !== value;
  lastSandboxValue = value;
  frame.setAttribute('sandbox', value);
  if (changed && currentSrcdoc) run('full');   // sandbox flags apply on navigation
}
export function initPreview() {
  frame = $('#previewFrame'); stage = $('#previewStage'); wrap = $('#previewFrameWrap');
  window.addEventListener('message', onFrameMessage);
  applySandbox();
  frame.addEventListener('load', () => emit('preview:load'));

  // Three clear form factors: desktop / tablet / phone (+ custom size).
  $$('#deviceSwitch [data-device]').forEach(btn => {
    btn.addEventListener('click', () => setDevice(btn.dataset.device));
  });
  $('#viewportWidth')?.addEventListener('change', e => {
    state.deviceSize.w = Math.max(240, Math.min(2400, +e.target.value || 400));
    setDeviceButtons('custom'); applyDevice();
  });
  $('#viewportHeight')?.addEventListener('change', e => {
    state.deviceSize.h = Math.max(200, Math.min(3000, +e.target.value || 400));
    setDeviceButtons('custom'); applyDevice();
  });
  setDevice(state.device || 'desktop');
  $('#zoomSelect')?.addEventListener('change', e => { state.zoom = e.target.value === 'fit' ? 'fit' : +e.target.value; applyDevice(); });
  $('#optAutoRun')?.addEventListener('change', e => { state.autoRun = e.target.checked; state.settings.autoRun = e.target.checked; });
  $('#optJs')?.addEventListener('change', e => { state.jsEnabled = e.target.checked; run('full'); });
  $('#optExternal')?.addEventListener('change', e => { state.externalEnabled = e.target.checked; run('full'); });
  $('#optAlerts')?.addEventListener('change', e => { state.alertsAsToast = e.target.checked; });
  $('#optScheme')?.addEventListener('change', e => send('setScheme', { value: e.target.value }));
  $('#optMotion')?.addEventListener('change', e => send('setMotion', { value: e.target.value }));
  $('#optLocale')?.addEventListener('change', e => { send('setLocale', { value: e.target.value }); if (e.target.value === 'ar') toast('Включён RTL-режим предпросмотра', 'info'); });
  window.addEventListener('resize', debounce(applyDevice, 180));

  // hover / select overlays, rulers, guides, measurement
  wrap?.addEventListener('mousedown', e => {
    if (!e.altKey) return;
    measureStart = { x: e.offsetX, y: e.offsetY };
    e.preventDefault();
  });
  wrap?.addEventListener('mousemove', e => {
    if (!measureStart) return;
    const dx = Math.abs(e.offsetX - measureStart.x), dy = Math.abs(e.offsetY - measureStart.y);
    $('#guideV').style.left = Math.min(e.offsetX, measureStart.x) + 'px';
    $('#guideH').style.top = Math.min(e.offsetY, measureStart.y) + 'px';
    $('#previewHint').textContent = `Ш ${dx}px · В ${dy}px · диагональ ${Math.round(Math.hypot(dx, dy))}px`;
  });
  wrap?.addEventListener('mouseup', () => { measureStart = null; });

  on('files:changed', d => {
    if (!state.autoRun) return;
    const p = d.path || '';
    if (p.endsWith('.css') || p.endsWith('.scss')) scheduleRun('css');
    else if (/\.(js|mjs|ts|jsx)$/.test(p)) scheduleRun('js');
    else scheduleRun('full');
  });
  on('project:loaded', () => { lastHash = { html: '', css: '', js: '' }; });
  on('settings:changed', () => { applyDevice(); applySandbox(); });
  on('deps:changed', () => run('full'));
  on('cursor', d => {
    if (d.pane !== 'html' || !state.settings.codeToPreview) return;
    scheduleHighlight(d.line);
  });
  applyDevice();
  setTimeout(() => run('full'), 100);
}

export function setDeviceButtons(name) {
  $$('#deviceSwitch [data-device]').forEach(b => b.classList.toggle('active', b.dataset.device === name));
  const d = DEVICES[name];
  const hint = $('#previewHint');
  if (hint && d) hint.textContent = `${d.label} · ${d.hint} · ${state.deviceSize.w}×${state.deviceSize.h}`;
}
export function setDevice(name) {
  const d = DEVICES[name] || DEVICES.desktop;
  state.device = name;
  state.deviceSize = { w: d.w, h: d.h };
  const w = $('#viewportWidth'), h = $('#viewportHeight');
  if (w) w.value = d.w; if (h) h.value = d.h;
  setDeviceButtons(name); applyDevice(); emit('device:changed', name);
}

let runTimer = null;
function scheduleRun(reason) {
  clearTimeout(runTimer);
  runTimer = setTimeout(() => run(reason), state.settings.autoRunDelay || 700);
}
const scheduleHighlight = debounce(line => {
  const pane = state.panes.html;
  const doc = getDoc('html');
  const lines = doc.split('\n');
  const text = lines[line - 1] || '';
  const idm = /id=["']([^"']+)["']/.exec(text);
  const sel = idm ? '#' + idm[1] : (/<([\w-]+)/.exec(text) || [])[1];
  if (sel && sel.length <= 200) send('highlight', { selector: sel });
}, 420);

/* ── messaging ──────────────────────────────────────────────────── */
export function send(type, data = {}) {
  if (!frame?.contentWindow || typeof type !== 'string' || type.length > 48) return;
  try { frame.contentWindow.postMessage({ __rlcmd: true, fid: currentFid, type, data }, '*'); } catch (e) { }
}
export function request(type, data = {}, timeout = 1500) {
  return new Promise(resolve => {
    const id = ++reqId;
    requests.set(id, resolve);
    send(type, { ...data, id });
    setTimeout(() => { if (requests.has(id)) { requests.delete(id); resolve(null); } }, timeout);
  });
}
function onFrameMessage(e) {
  const msg = e.data;
  if (!msg || typeof msg !== 'object' || msg.__runlet !== true) return;
  // Only the CURRENT preview document may talk to us; a stale srcdoc or a
  // forged message from another frame is dropped. Sandboxed srcdoc has an
  // opaque origin, so e.origin is the literal string "null".
  if (frame && e.source !== frame.contentWindow) return;
  if (msg.fid !== currentFid || (e.origin !== 'null' && e.origin !== location.origin)) return;
  if (typeof msg.type !== 'string' || msg.type.length > 48 || !msg.data || typeof msg.data !== 'object') return;
  let packed;
  try { packed = JSON.stringify(msg.data); } catch (_) { return; }
  if (!packed || packed.length > 512000) return;      // flood / zip-bomb guard
  let data;
  try { data = JSON.parse(packed); } catch (_) { return; }  // strips prototypes & functions
  const type = msg.type;
  switch (type) {
    case 'ready':
      state.perf = { ...state.perf, renderMs: data.ms, elements: data.elements };
      state.analytics.views++;
      emit('preview:ready', data);
      break;
    case 'console':
      state.logs.push({ ...data, seq: state.logs.length });
      if (state.logs.length > 1200) state.logs.shift();
      emit('console:log', data);
      break;
    case 'console-clear': state.logs = []; emit('console:clear'); break;
    case 'error':
      state.logs.push({ level: 'error', text: data.text, args: [], stack: data.stack,
                        line: data.line, source: data.source, time: Date.now(), seq: state.logs.length });
      emit('console:log', { level: 'error', text: data.text });
      emit('preview:error', data);
      if (runCount > 1) toast(String(data.text || '').slice(0, 120), 'err', 'Ошибка в предпросмотре');
      break;
    case 'alert':
      if (state.alertsAsToast) toast(String(data.text).slice(0, 220), data.level || 'info', 'Из предпросмотра');
      break;
    case 'hover': showHighlight('#hoverHighlight', data); break;
    case 'select':
      showHighlight('#selectHighlight', data);
      state.computedStyles = data.styles || {};
      state.selectedElement = data;
      emit('element:select', data);
      if (state.inspectMode) {
        const html = getDoc('html');
        const idx = html.indexOf(String(data.html || '').slice(0, 40));
        if (idx >= 0) goto('html', html.slice(0, idx).split('\n').length);
        else toast(`Выбран <${data.tag}> — ${data.selector}`, 'info', 'Инспектор');
      }
      break;
    case 'network': state.network.push(data); emit('network', data); break;
    case 'network-all': state.network = data.items || []; emit('network-all'); break;
    case 'storage': state.storageData[data.store] = { ...(state.storageData[data.store] || {}), [data.key]: data.value }; emit('storage'); break;
    case 'storage-all': state.storageData = data; emit('storage-all', data); break;
    case 'dom': state.domTree = data.tree; emit('dom', data.tree); break;
    case 'styles': state.computedStyles = data.styles; emit('styles', data); break;
    case 'listeners': state.listeners = data.items; emit('listeners', data.items); break;
    case 'perf': state.perf = { ...state.perf, ...data }; emit('perf', state.perf); break;
    case 'trace': state.trace = data.items || []; emit('trace', state.trace); break;
    case 'breakpoint': emit('breakpoint', data); toast(`Точка останова: ${data.file}:${data.line}`, 'warn', 'Отладка'); break;
    case 'form-state': formState = data; break;
    case 'eval-result': {
      const r = requests.get(data.id); if (r) { requests.delete(data.id); r(data); }
      if (!r) emit('eval:result', data);
      break;
    }
    case 'a11y': emit('a11y:scan', data); break;
  }
}
function showHighlight(sel, data) {
  const box = $(sel); if (!box) return;
  const r = data.rect || {};
  // Overlay lives INSIDE the scaled frame wrapper, so use iframe coordinates
  // directly (the wrapper transform scales both the iframe and the overlay).
  box.style.left = (r.x || 0) + 'px';
  box.style.top = (r.y || 0) + 'px';
  box.style.width = (r.w || 0) + 'px';
  box.style.height = (r.h || 0) + 'px';
  box.classList.add('show');
  box.innerHTML = `<span class="hover-label">${esc(String(data.tag || '').slice(0, 34))} · ${Math.round(r.w || 0)}×${Math.round(r.h || 0)}</span>`;
  if (sel === '#hoverHighlight') setTimeout(() => box.classList.remove('show'), 900);
}

/* ── virtual path resolution ────────────────────────────────────── */
function resolvePath(base, ref) {
  ref = ref.split('#')[0].split('?')[0].trim();
  if (/^(https?:|data:|blob:|mailto:|javascript:|\/\/)/i.test(ref) || !ref) return null;
  if (ref.startsWith('/')) return ref.slice(1);
  const parts = (base.includes('/') ? base.slice(0, base.lastIndexOf('/') + 1) : '') + ref;
  const stack = [];
  for (const p of parts.split('/')) {
    if (!p || p === '.') continue;
    if (p === '..') stack.pop(); else stack.push(p);
  }
  return stack.join('/');
}
function lookup(base, ref) {
  const p = resolvePath(base, ref);
  if (!p) return null;
  if (exists(p)) return p;
  return listFiles().find(f => f === p || f.endsWith('/' + p)) || null;
}
function asDataUri(path) {
  const c = read(path);
  if (/^data:/.test(c)) return c;
  const mime = mimeOf(path);
  if (mime === 'image/svg+xml') return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(c);
  return 'data:' + mime + ';charset=utf-8,' + encodeURIComponent(c);
}
function inlineCss(css, file) {
  let out = css.replace(/\/\*[\s\S]*?\*\//g, m => m);
  // @import of local CSS
  out = out.replace(/@import\s+(?:url\()?\s*['"]([^'"]+)['"]\s*\)?\s*;?/g, (m, ref) => {
    const p = lookup(file, ref);
    return p && /\.(css|scss)$/i.test(p) ? inlineCss(read(p), p) : m;
  });
  // url() references
  out = out.replace(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g, (m, ref) => {
    const p = lookup(file, ref);
    return p ? `url("${asDataUri(p)}")` : m;
  });
  return out;
}
function moduleDataUrl(path, seen = new Set()) {
  if (seen.has(path)) return 'data:text/javascript,' + encodeURIComponent('export default {};');
  seen.add(path);
  let code = read(path);
  code = rewriteImports(code, path, seen);
  return 'data:text/javascript;charset=utf-8,' + encodeURIComponent(code);
}
function rewriteImports(code, file, seen = new Set()) {
  return code.replace(/(\bfrom\s*|\bimport\s*\(?\s*|\bexport\s+\*\s+from\s*)(['"])([^'"]+)(['"])/g, (m, pre, q1, ref, q2) => {
    const p = lookup(file, ref);
    if (p) return pre + q1 + moduleDataUrl(p, seen) + q2;
    if (/^https?:\/\//.test(ref)) return m;
    if (/^(esm\.sh|skypack|cdn)/.test(ref)) return pre + q1 + 'https://' + ref + q2;
    return m;
  });
}
function compileScss(code) {
  // mini-Sass: variables + one-level nesting + & parent
  const vars = {};
  code = code.replace(/\$([\w-]+)\s*:\s*([^;]+);/g, (m, k, v) => { vars[k] = v.trim(); return ''; });
  code = code.replace(/\$([\w-]+)/g, (m, k) => vars[k] ?? m);
  const lines = code.split('\n'); const out = []; const stack = [];
  let buf = '';
  const flush = () => { if (buf.trim()) { out.push(buf.trim()); buf = ''; } };
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    if (t.endsWith('{')) {
      flush(); const sel = t.slice(0, -1).trim();
      const parent = stack.length ? stack[stack.length - 1].sel : '';
      const full = sel.includes('&') ? sel.replace(/&/g, parent) : (parent ? parent + ' ' + sel : sel);
      stack.push({ sel: full, body: [] });
    } else if (t === '}') {
      const block = stack.pop();
      if (!block) continue;
      const decls = block.body.join('\n');
      if (decls) { if (stack.length) stack[stack.length - 1].body.push(`${block.sel} { ${decls.replace(/\n/g, ' ')} }`); else out.push(`${block.sel} { ${decls} }`); }
    } else if (stack.length) stack[stack.length - 1].body.push(t);
    else buf += t + '\n';
  }
  flush();
  return out.join('\n');
}
function compilePug(code) {
  const out = []; const stack = [];
  for (const raw of code.split('\n')) {
    if (!raw.trim() || raw.trim().startsWith('//')) continue;
    const indent = (raw.match(/^\s*/) || [''])[0].length;
    const line = raw.trim();
    const m = /^([\w-]+)?(?:([.#][\w.#-]+)?)?(?:\(([^)]*)\))?\s*(.*)$/.exec(line);
    if (!m) continue;
    let tag = m[1] || 'div';
    let cls = (m[2] || '').split('.').filter(Boolean).join(' ');
    const idm = /#([\w-]+)/.exec(m[2] || '');
    const attrs = (idm ? ` id="${idm[1]}"` : '') + (cls ? ` class="${cls}"` : '');
    while (stack.length && stack[stack.length - 1].indent >= indent) out.push(`</${stack.pop().tag}>`);
    const voids = ['img', 'input', 'br', 'hr', 'meta', 'link'];
    if (voids.includes(tag)) out.push(`<${tag}${attrs}${m[3] ? ' ' + m[3].replace(/,/g, ' ') : ''}>`);
    else { out.push(`<${tag}${attrs}>${m[4] || ''}`); stack.push({ tag, indent }); }
  }
  while (stack.length) out.push(`</${stack.pop().tag}>`);
  return out.join('\n');
}
export function miniMarkdown(md) {
  return md.replace(/^### (.*)$/gm, '<h3>$1</h3>').replace(/^## (.*)$/gm, '<h2>$1</h2>')
    .replace(/^# (.*)$/gm, '<h1>$1</h1>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/^\s*[-*] (.*)$/gm, '<li>$1</li>').replace(/(<li>[\s\S]*?<\/li>)/g, '<ul>$1</ul>')
    .split(/\n{2,}/).map(b => /^<(h\d|ul|pre|blockquote)/.test(b.trim()) ? b : `<p>${b.replace(/\n/g, '<br>')}</p>`).join('\n');
}
function stripTypes(code) {
  return code.replace(/(\b(?:let|const|var)\s+[\w$]+)\s*:\s*[^=;]+(?=[=;])/g, '$1')
    .replace(/\(([^)]*)\)\s*:\s*[\w<>\[\]|, ]+(?=\s*(?:=>|\{))/g, '($1)')
    .replace(/:\s*(?:string|number|boolean|any|unknown|void|never)(\[\])?(?=\s*[,)=;])/g, '')
    .replace(/\bas\s+(?:string|number|boolean|any|unknown|const)\b/g, '')
    .replace(/^\s*(interface|type)\s+\w+[^{]*\{[\s\S]*?\}\s*/gm, '');
}
function transformJsx(code) {
  // very small JSX → React.createElement for simple tags
  return code.replace(/<([a-zA-Z][\w-]*)([^>]*)>([\s\S]*?)<\/\1>/g, (m, tag, attrs, kids) => {
    const props = {};
    attrs.replace(/([\w-]+)\s*=\s*(?:"([^"]*)"|\{([^}]*)\})/g, (x, k, v, e) => { props[k] = e || JSON.stringify(v); return ''; });
    const p = Object.entries(props).map(([k, v]) => `${JSON.stringify(k)}: ${v}`).join(', ');
    const children = kids.trim() ? JSON.stringify(kids.trim()) : 'null';
    return `React.createElement(${JSON.stringify(tag)}, {${p}}, ${children})`;
  });
}

/* ── tracing instrumentation ────────────────────────────────────── */
export function instrumentJS(code, file) {
  if (!code.trim() || code.length > 200000) return code;
  let ast;
  try {
    ast = acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'module', locations: true,
                             allowAwaitOutsideFunction: true, allowReturnOutsideFunction: true });
  } catch (e) { return code; } // leave broken code as is — iframes will report the error
  const inserts = [];
  const seen = new Set();
  function declaredIn(body) {
    const names = new Set();
    for (const n of body || []) {
      if (!n || typeof n !== 'object') continue;
      if (n.type === 'VariableDeclaration') for (const d of n.declarations) if (d.id.type === 'Identifier') names.add(d.id.name);
      else if (n.type === 'FunctionDeclaration' && n.id) names.add(n.id.name);
      else if (n.type === 'ClassDeclaration' && n.id) names.add(n.id.name);
      else if (n.type === 'ImportDeclaration') for (const s of n.specifiers) names.add(s.local.name);
      else if (n.type === 'ExpressionStatement' && n.expression.type === 'AssignmentExpression' && n.expression.left.type === 'Identifier') names.add(n.expression.left.name);
    }
    return [...names].filter(n => /^[A-Za-z_$][\w$]*$/.test(n)).slice(0, 24);
  }
  function walkBlock(body, vars) {
    if (!Array.isArray(body)) return;
    const names = [...new Set([...(vars || []), ...declaredIn(body)])];
    for (const node of body) {
      if (!node || typeof node.start !== 'number') continue;
      if (node.type === 'ExpressionStatement' && node.expression.type === 'CallExpression' &&
          node.expression.callee?.object?.name === '__RL') continue;
      const line = node.loc?.start.line || 1;
      if (!seen.has(node.start) && !['EmptyStatement', 'BreakStatement', 'ContinueStatement'].includes(node.type)) {
        seen.add(node.start);
        const thunk = names.length ? `()=>{try{return {${names.join(',')}}}catch(e){return {}}}` : 'null';
        inserts.push({ pos: node.start, text: `__RL.t(${JSON.stringify(file)},${line},${thunk});` });
      }
      // Only descend into real block bodies / function bodies: inserting a
      // statement before an expression (call args, for-init, single if-body)
      // would produce invalid JavaScript.
      descend(node, names);
    }
  }
  function descend(node, names) {
    const next = [...names, ...paramsOf(node)];
    const bodies = [];
    if (node.body && Array.isArray(node.body.body)) bodies.push(node.body.body);           // function / arrow block
    else if (node.body && Array.isArray(node.body)) bodies.push(node.body);                 // Program / BlockStatement
    for (const key of ['consequent', 'alternate', 'finalizer']) {
      const v = node[key];
      if (v && v.type === 'BlockStatement') bodies.push(v.body);
    }
    if (node.block && node.block.type === 'BlockStatement') bodies.push(node.block.body);
    if (node.handler && node.handler.body && node.handler.body.type === 'BlockStatement') bodies.push(node.handler.body.body);
    if (Array.isArray(node.cases)) for (const c of node.cases) if (Array.isArray(c.consequent)) bodies.push(c.consequent);
    for (const b of bodies) walkBlock(b, next);
  }
  function paramsOf(node) {
    const out = [];
    for (const p of (node.params || [])) {
      if (p.type === 'Identifier') out.push(p.name);
      else if (p.type === 'AssignmentPattern' && p.left.type === 'Identifier') out.push(p.left.name);
    }
    return out;
  }
  walkBlock(ast.body, []);
  inserts.sort((a, b) => a.pos - b.pos);
  let out = '', last = 0;
  for (const ins of inserts) {
    out += code.slice(last, ins.pos) + ins.text;
    last = ins.pos;
  }
  return out + code.slice(last);
}

/* ── srcdoc builder ─────────────────────────────────────────────── */
function buildSrcdoc() {
  const entry = state.entry || 'index.html';
  let html = exists(entry) ? read(entry) : getDoc('html');
  const files = state.files;
  const cssFiles = listFiles().filter(p => /\.(css|scss|less)$/i.test(p));
  const jsFiles = listFiles().filter(p => /\.(js|mjs|ts|jsx|tsx)$/i.test(p));
  const styles = [];
  const scripts = [];
  const inlinedScripts = new Set();
  const inlinedStyles = new Set();

  // inject CDN dependencies
  for (const dep of state.deps) {
    const lib = CDN_LIBS.find(l => l.id === (typeof dep === 'string' ? dep : dep.id));
    if (!lib || (typeof dep === 'object' && dep.enabled === false)) continue;
    const v = (typeof dep === 'object' && dep.version) || lib.versions[0];
    const url = typeof lib.url === 'function' ? lib.url(v) : lib.url;
    if (/\.css|css\?/.test(url)) styles.push(`<link rel="stylesheet" href="${esc(url)}">`);
    else scripts.push(`<script src="${esc(url)}"></script>`);
    if (lib.js) scripts.push(`<script src="${esc(lib.js(v))}" defer></script>`);
    for (const x of lib.extra || []) scripts.push(`<script src="${esc(x)}"></script>`);
  }

  // inline local CSS referenced with <link>
  html = html.replace(/<link\b[^>]*rel=["']?stylesheet["']?[^>]*>/gi, tag => {
    const href = /href=["']([^"']+)["']/i.exec(tag)?.[1] || '';
    const p = lookup(entry, href);
    if (!p) return tag;
    let c = /\.(scss|sass)$/i.test(p) ? compileScss(read(p)) : read(p);
    c = inlineCss(c, p);
    inlinedStyles.add(p);
    return `<style data-runlet="${esc(p)}">\n${c}\n</style>`;
  });
  // inline local scripts
  html = html.replace(/<script\b([^>]*)\bsrc=["']([^"']+)["']([^>]*)>\s*<\/script>/gi, (m, a, src, b) => {
    const p = lookup(entry, src);
    if (!p) return m;
    let code = read(p);
    if (/\.tsx?$/i.test(p)) code = stripTypes(code);
    if (/\.jsx$/i.test(p)) code = transformJsx(code);
    code = rewriteImports(code, p);
    if (state.jsEnabled) code = instrumentJS(code, p);
    const moduleAttr = /type=["']module["']/.test(a + b) ? ' type="module"' : '';
    inlinedScripts.add(p);
    scripts.push(`<script${moduleAttr} data-runlet="${esc(p)}">\n${escapeScript(code)}\n</script>`);
    return `<!-- script ${esc(p)} inlined -->`;
  });
  // images / media / iframes with local sources
  html = html.replace(/\b(src|poster|data|href)=["']([^"'#]+)["']/gi, (m, attr, ref) => {
    const p = lookup(entry, ref);
    if (!p) return m;
    if (/\.(css|js|html?)$/i.test(p) && attr === 'href') return m;
    if (/\.svg$/i.test(p) && attr === 'src') return `${attr}="${asDataUri(p)}"`;
    return `${attr}="${esc(asDataUri(p))}"`;
  });
  // srcset
  html = html.replace(/\bsrcset=(["'])([^"']+)\1/gi, (m, q, val) => 'srcset=' + q + val.replace(/([^\s,]+)(\s+\d+[wx])?/g, (mm, ref, size) => {
    const p = lookup(entry, ref); return p ? asDataUri(p) + (size || '') : mm;
  }) + q);
  // inline <style> and <script> blocks: CSS url() and JS syntax transforms
  html = html.replace(/<style\b([^>]*)>([\s\S]*?)<\/style>/gi, (m, attrs, css) => `<style${attrs}>${inlineCss(css, entry)}</style>`);
  html = html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (m, attrs, code) => {
    if (/type=["']application\/(ld\+)?json["']/i.test(attrs) || /src=/.test(attrs)) return m;
    if (!state.jsEnabled) return '<!-- JS отключён -->';
    let c = code;
    if (/type=["'](text\/babel|text\/jsx)["']/.test(attrs)) c = transformJsx(c);
    c = rewriteImports(c, entry);
    c = instrumentJS(c, entry + '::inline');
    return `<script${attrs}>${escapeScript(c)}</script>`;
  });

  // automatically attach standalone CSS/JS files that aren't linked in HTML
  const linked = [...html.matchAll(/data-runlet="([^"]+)"/g)].map(m => m[1]);
  for (const p of cssFiles) if (!linked.includes(p) && !inlinedStyles.has(p) && !html.includes(`href="${p}"`)) {
    let c = /\.(scss|sass)$/i.test(p) ? compileScss(read(p)) : read(p);
    styles.push(`<style data-runlet="${esc(p)}">\n${inlineCss(c, p)}\n</style>`);
  }
  for (const p of jsFiles) if (!linked.includes(p) && !inlinedScripts.has(p) && !html.includes(`src="${p}"`) && /\.(js|mjs|ts|jsx|tsx)$/.test(p)) {
    let c = read(p);
    if (/\.tsx?$/i.test(p)) c = stripTypes(c);
    if (/\.jsx$/i.test(p)) c = transformJsx(c);
    c = rewriteImports(c, p);
    if (state.jsEnabled) c = instrumentJS(c, p);
    scripts.push(`<script data-runlet="${esc(p)}">\n${escapeScript(c)}\n</script>`);
  }
  if (/\.pug$/i.test(entry)) html = compilePug(html);
  if (/\.md$/i.test(entry)) html = miniMarkdown(html);

  // configuration + bridge
  currentFid = 'rl' + (++fid);
  const virtualFiles = {};
  let virtualBytes = 0;
  for (const [p, f] of Object.entries(files)) {
    if (/\.(css|js|html?|scss)$/i.test(p) || typeof f.content !== 'string') continue;
    virtualBytes += f.content.length;
    if (virtualBytes > 4 * 1024 * 1024) break;
    virtualFiles[p] = f.content.slice(0, 2 * 1024 * 1024);
  }
  const cfg = {
    fid: currentFid,
    files: virtualFiles,
    breakpoints: state.breakpoints,
    scheme: $('#optScheme')?.value || 'auto',
    motion: $('#optMotion')?.value || 'no-preference',
    locale: $('#optLocale')?.value || 'ru',
    inspect: state.inspectMode,
    jsEnabled: state.jsEnabled,
    formState,
    timeLimit: 4000
  };
  const csp = state.externalEnabled ? '' :
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' data: blob:; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data:; connect-src 'none'">`;
  const bridge = `<script>window.__RL_CFG__=${jsonForScript(cfg)};<\/script><script>${bridgeSource()}<\/script>`;
  const headExtra = csp + bridge + styles.join('\n');
  const tail = state.jsEnabled ? scripts.join('\n') : '';

  if (/<head[^>]*>/i.test(html)) html = html.replace(/<head([^>]*)>/i, (m, a) => `<head${a}>${headExtra}`);
  else html = `<head>${headExtra}</head>` + html;
  if (/<\/body>/i.test(html)) html = html.replace(/<\/body>/i, tail + '\n</body>');
  else html += tail;
  if (!/^\s*<!doctype/i.test(html)) html = '<!DOCTYPE html>\n' + html;
  return html;
}
function escapeScript(code) {
  return String(code).replace(/<\/script/gi, '<\\/script').replace(/<\/style/gi, '<\\/style');
}
function jsonForScript(o) {
  // < keeps the HTML parser from ever seeing "</script>" in the source,
  // while the JS string itself still decodes to the original characters.
  return JSON.stringify(o).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/* ── run / hot swap ─────────────────────────────────────────────── */
export function run(reason = 'full') {
  if (!frame) return;
  runCount++;
  const cssChanged = reason === 'css';
  const jsChanged = reason === 'js';
  if (cssChanged && currentSrcdoc && state.settings.hotCss !== false) {
    const cssFiles = listFiles().filter(p => /\.(css|scss)$/i.test(p));
    const css = cssFiles.map(p => inlineCss(/\.(scss|sass)$/i.test(p) ? compileScss(read(p)) : read(p), p)).join('\n');
    send('hotcss', { css, file: cssFiles[0] || 'style.css' });
    emit('preview:hotcss');
    return;
  }
  if (jsChanged && currentSrcdoc && state.settings.hotJs !== false) {
    const p = state.panes.js;
    let code = exists(p) ? read(p) : '';
    if (/\.tsx?$/i.test(p)) code = stripTypes(code);
    code = rewriteImports(code, p);
    // re-evaluate in a fresh function scope so top-level const can be redeclared
    send('hotjs', { code: `(function(){\n${code}\n})();` });
    emit('preview:hotjs');
    return;
  }
  const next = buildSrcdoc();
  if (next.length > 8 * 1024 * 1024) { toast('Предпросмотр слишком большой (>8 МБ) — запуск пропущен', 'err'); return; }
  currentSrcdoc = next;
  lastHash = { html: hash(read(state.entry)), css: hash(listFiles().filter(p => /\.css$/i.test(p)).map(read).join('')), js: hash(getDoc('js')) };
  frame.srcdoc = currentSrcdoc;
  emit('preview:run', { reason, size: currentSrcdoc.length });
}
function hash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0; return h; }
export function srcdoc() { return currentSrcdoc || buildSrcdoc(); }
export function exportSingleHtml() { return srcdoc(); }

/* ── devices / viewport ─────────────────────────────────────────── */
export function currentScale() {
  if (state.zoom === 'fit') {
    const availW = (stage?.clientWidth || 400) - 26;
    return Math.max(0.1, Math.min(1, availW / Math.max(1, state.deviceSize.w)));
  }
  return +state.zoom || 1;
}
export function applyDevice() {
  if (!wrap || !stage) return;
  const s = currentScale();
  wrap.style.setProperty('--frame-w', state.deviceSize.w + 'px');
  wrap.style.setProperty('--frame-h', state.deviceSize.h + 'px');
  wrap.style.width = state.deviceSize.w + 'px';
  wrap.style.height = state.deviceSize.h + 'px';
  wrap.style.transform = `scale(${s})`;
  wrap.style.transformOrigin = 'top center';
  stage.style.justifyContent = 'center';
}
export function rotateDevice() {
  const { w, h } = state.deviceSize;
  state.deviceSize = { w: h, h: w };
  $('#viewportWidth').value = h; $('#viewportHeight').value = w;
  applyDevice(); toast(`Ориентация: ${w}×${h} → ${h}×${w}`, 'info', 'Устройство');
}

/* ── preview tools ──────────────────────────────────────────────── */
export function toggleGrid() { $('#gridOverlay')?.classList.toggle('show'); }
export function toggleRulers() {
  const on = !$('#rulerTop')?.classList.contains('show');
  $('#rulerTop')?.classList.toggle('show', on);
  $('#rulerLeft')?.classList.toggle('show', on);
  $('#guideV')?.classList.toggle('show', on);
  $('#guideH')?.classList.toggle('show', on);
  if (on) {
    const gv = $('#guideV'), gh = $('#guideH');
    if (gv) gv.style.left = '50%'; if (gh) gh.style.top = '50%';
    $('#previewHint').textContent = 'Линейки и направляющие включены · Alt+drag по рамке — замер';
  } else $('#previewHint').textContent = '⟵ перетащите разделитель, чтобы изменить размер';
}
export async function eyedropper() {
  if (!window.EyeDropper) { toast('EyeDropper не поддерживается этим браузером', 'warn'); return; }
  try {
    const ed = new EyeDropper();
    const res = await ed.open();
    await copy(res.sRGBHex);
    toast(`Цвет ${res.sRGBHex} скопирован в буфер`, 'ok', 'Пипетка');
  } catch (e) { /* cancelled */ }
}
export function toggleInspect() {
  state.inspectMode = !state.inspectMode;
  send('setInspect', { value: state.inspectMode });
  $('[data-cmd="inspectMode"]')?.classList.toggle('active', state.inspectMode);
  toast(state.inspectMode ? 'Клик по элементу покажет его код и стили' : 'Инспектор выключен', 'info');
}
export function previewFullscreen() { $('#previewCard')?.classList.toggle('preview-max'); setTimeout(applyDevice, 80); }
export function popout() {
  const html = srcdoc();
  if (window.runlet?.popout) {
    // Electron: main process opens an isolated data: window with NO opener,
    // instead of letting the renderer create a privileged child window.
    Promise.resolve(window.runlet.popout(html)).then(ok => {
      if (ok) toast('Предпросмотр открыт в новом окне', 'ok');
      else toast('Не удалось открыть окно предпросмотра', 'err');
    }).catch(() => toast('Не удалось открыть окно предпросмотра', 'err'));
    return;
  }
  const w = window.open('', 'runlet-preview', 'width=1000,height=760');
  if (!w) { toast('Браузер заблокировал новое окно', 'err'); return; }
  w.opener = null;
  w.document.open(); w.document.write(html); w.document.close();
  toast('Предпросмотр открыт в новом окне', 'ok');
}
export function reload() { send('hotcss', { css: '', file: '' }); run('full'); }
export function evalInPreview(expr) { return request('eval', { expr }); }
export function refreshInspectors() {
  send('getDOM', {}); send('getListeners', {}); send('getStorage', {});
  send('getNetwork', {}); send('getPerf', {}); send('getTrace', {});
}
export function emulateA11y() { send('a11yScan', {}); }
export function screenReader() { send('speech', { lang: $('#optLocale')?.value === 'en' ? 'en-US' : 'ru-RU' }); }
export function setBreakpoint(file, line, condition = '') {
  state.breakpoints[file] = state.breakpoints[file] || [];
  const existing = state.breakpoints[file].find(b => b.line === line);
  if (existing) state.breakpoints[file] = state.breakpoints[file].filter(b => b.line !== line);
  else state.breakpoints[file].push({ line, condition, enabled: true });
  emit('breakpoints', state.breakpoints);
}
