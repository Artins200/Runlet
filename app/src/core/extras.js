/* Learning centre, plugin system, feature coverage map, mini-plugin tools. */
import { state, ctx, $, el, esc, on, emit, toast, copy, download, debounce } from './core.js';
import { LESSONS, QUIZZES, RECIPES, PLUGIN_CATALOG, FEATURES, IMPLEMENTED, PARTIAL_SET, coverage } from './data.js';
import { getDoc, setDoc, insertText } from './editor.js';
import { runAnalysis } from './analyzer.js';
import { write } from './state.js';
import { paletteFrom, unitConvert, specificity, randomColor, safeCalc } from './tools.js';
import { icon } from './icons.js';

/* ══════════════════ learning ══════════════════ */
export function initLearn() {
  const host = $('#learnPanel'); if (!host) return;
  renderLearn();
}
export function renderLearn() {
  const host = $('#learnPanel'); if (!host) return;
  const done = Object.keys(state.progress).filter(k => state.progress[k]).length;
  host.innerHTML = `<div class="rowflex mb8"><span class="pill pill-accent"> ${done}/${LESSONS.length} уроков</span>
    <div class="progress" style="flex:1"><i style="width:${Math.round(done / LESSONS.length * 100)}%"></i></div></div>
    <div class="tabs-line" id="learnTabs"><button class="active" data-lt="lessons">Уроки</button>
      <button data-lt="quiz">Квизы</button><button data-lt="recipes">Рецепты</button>
      <button data-lt="viz">Визуализации</button><button data-lt="achieve">Достижения</button></div>
    <div id="learnBody"></div>`;
  host.querySelectorAll('[data-lt]').forEach(b => b.onclick = () => {
    host.querySelectorAll('[data-lt]').forEach(x => x.classList.remove('active'));
    b.classList.add('active'); renderLearnTab(b.dataset.lt);
  });
  renderLearnTab('lessons');
}
function renderLearnTab(tab) {
  const box = $('#learnBody'); if (!box) return;
  if (tab === 'lessons') {
    box.innerHTML = '<div class="list-rows"></div>';
    const list = box.querySelector('.list-rows');
    for (const l of LESSONS) {
      const done = state.progress[l.id];
      const row = el('div', { class: 'list-row' },
        el('div', { class: 'grow' }, el('b', { text: (done ? ' ' : ' ') + l.title }),
          el('small', { text: l.lang + ' · ' + l.task.slice(0, 60) + '…' })),
        el('button', { class: 'mini-btn', text: done ? 'Повторить' : 'Начать' }));
      row.querySelector('button').onclick = () => openLesson(l);
      list.appendChild(row);
    }
  } else if (tab === 'quiz') {
    box.innerHTML = QUIZZES.map((q, i) => `<div class="list-row" style="flex-direction:column;align-items:stretch">
      <b>${i + 1}. ${esc(q.q)}</b><div class="mt8">${q.opts.map((o, j) => `<button class="quiz-opt" data-q="${i}" data-o="${j}">${esc(o)}</button>`).join('')}</div>
      <div class="quiz-result" id="qr${i}"></div></div>`).join('');
    box.querySelectorAll('.quiz-opt').forEach(b => b.onclick = () => {
      const qi = +b.dataset.q, oi = +b.dataset.o, q = QUIZZES[qi];
      const group = box.querySelectorAll(`[data-q="${qi}"]`);
      group.forEach(x => x.classList.remove('correct', 'wrong'));
      b.classList.add(oi === q.a ? 'correct' : 'wrong');
      group[q.a].classList.add('correct');
      box.querySelector('#qr' + qi).innerHTML = `<div class="beginner mt8">${oi === q.a ? ' Верно! ' : ' Не совсем. '}${esc(q.why)}</div>`;
      if (oi === q.a) { state.progress['quiz' + qi] = true; toast('Достижение: верный ответ', 'ok'); }
    });
  } else if (tab === 'recipes') {
    box.innerHTML = '<div class="list-rows"></div>';
    const list = box.querySelector('.list-rows');
    for (const r of RECIPES) {
      const row = el('div', { class: 'list-row', style: { flexDirection: 'column', alignItems: 'stretch' } },
        el('b', { text: ' ' + r.t }), el('code', { class: 'inline', text: r.a, style: { marginTop: '6px', whiteSpace: 'pre-wrap' } }),
        el('button', { class: 'mini-btn mt8', text: 'Вставить', style: { alignSelf: 'flex-start' } }));
      row.querySelector('button').onclick = () => { insertText(r.a, /\{|:|;/.test(r.a) && !/\(\)/.test(r.a) ? 'css' : 'js'); toast('Рецепт вставлен', 'ok'); };
      list.appendChild(row);
    }
  } else if (tab === 'viz') {
    box.innerHTML = `<div class="tabs-line" id="vizTabs"><button class="active" data-viz="loop">Event loop</button>
      <button data-viz="async">async/await</button><button data-viz="cascade">CSS каскад</button>
      <button data-viz="dom">DOM</button><button data-viz="algo">Алгоритм</button></div><div id="vizBox"></div>`;
    box.querySelectorAll('[data-viz]').forEach(b => b.onclick = () => {
      box.querySelectorAll('[data-viz]').forEach(x => x.classList.remove('active')); b.classList.add('active'); drawViz(b.dataset.viz);
    });
    drawViz('loop');
  } else {
    const badges = [
      ['Первый шаг', () => Object.keys(state.progress).length > 0, 'check'],
      ['HTML-мастер', () => LESSONS.filter(l => l.lang === 'HTML').every(l => state.progress[l.id]), 'code'],
      ['CSS-стилист', () => LESSONS.filter(l => l.lang === 'CSS').every(l => state.progress[l.id]), 'palette'],
      ['JS-ниндзя', () => LESSONS.filter(l => l.lang === 'JS').every(l => state.progress[l.id]), 'braces'],
      ['Знаток', () => QUIZZES.every((_, i) => state.progress['quiz' + i]), 'book'],
      ['Аналитик', () => !!state.report, 'chart']
    ];
    box.innerHTML = `<div class="grid-cards">${badges.map(([n, f, ico]) => `<div class="tile" style="opacity:${f() ? 1 : .4}">
      <div class="tile-ico">${icon(ico, 18)}</div><b>${esc(n)}</b><small>${f() ? 'Получено ' : 'Ещё не получено'}</small></div>`).join('')}</div>
      <div class="beginner mt8"><b>Следующий шаг:</b> ${nextStep()}</div>`;
  }
}
function nextStep() {
  const l = LESSONS.find(x => !state.progress[x.id]);
  return l ? `Пройдите урок «${l.title}» (${l.lang}).` : 'Все уроки пройдены! Попробуйте создать свой проект с нуля и проверить его анализом.';
}
export function openLesson(lesson) {
  const pane = lesson.lang === 'HTML' ? 'html' : lesson.lang === 'CSS' ? 'css' : 'js';
  ctx.modal({
    title: `${lesson.lang} · ${lesson.title}`, wide: true,
    body: `<div class="beginner">${esc(lesson.theory)}</div>
      <h4 style="margin:14px 0 6px">Задание</h4><p>${esc(lesson.task)}</p>
      <div class="field"><label>Ваш код (панель ${lesson.lang})</label><textarea id="lessonCode" rows="9" style="font:12px var(--mono)">${esc(getDoc(pane).slice(0, 2000))}</textarea></div>
      <div class="rowflex"><button class="mini-btn" id="lessonLoad">${icon('refresh', 13)} Загрузить стартовый код</button>
        <button class="mini-btn" id="lessonHint"> Подсказка</button><button class="mini-btn" id="lessonCheck"> Проверить</button></div>
      <div id="lessonResult" class="mt8"></div>`,
    okText: 'Закрыть',
    onMount: root => {
      const ta = root.querySelector('#lessonCode');
      root.querySelector('#lessonLoad').onclick = () => { ta.value = lesson.starter; setDoc(lesson.starter, pane); };
      root.querySelector('#lessonHint').onclick = () => { root.querySelector('#lessonResult').innerHTML = `<div class="beginner"> ${esc(lesson.hint)}</div>`; };
      root.querySelector('#lessonCheck').onclick = () => {
        const code = ta.value;
        setDoc(code, pane);
        const ok = lesson.check(code);
        root.querySelector('#lessonResult').innerHTML = ok ?
          '<div class="beginner" style="border-color:var(--ok);color:var(--ok)"> Верно! Задание зачтено.</div>' :
          `<div class="beginner" style="border-color:var(--err);color:var(--err)"> Пока не подходит. ${esc(lesson.hint)}</div>`;
        if (ok) { state.progress[lesson.id] = true; emit('learn:progress'); toast('Урок пройден!', 'ok', 'Обучение'); renderLearn(); }
      };
    }
  });
}
function drawViz(kind) {
  const box = $('#vizBox'); if (!box) return;
  const scenes = {
    loop: [
      ['1. Синхронный код', 'console.log("A") выполняется сразу в стеке вызовов.'],
      ['2. setTimeout', 'Таймер уходит в Web API, стек освобождается.'],
      ['3. Микротаски', 'Promise.then() попадает в microtask queue и выполняется ДО макротасок.'],
      ['4. Event loop', 'Когда стек пуст, цикл берёт первую задачу из очереди: сначала microtasks, потом macrotasks.'],
      ['5. Результат', 'Порядок вывода: A → C (promise) → B (timeout).']
    ],
    async: [
      ['1. Вызов async-функции', 'Она сразу возвращает Promise (в состоянии pending).'],
      ['2. await fetch()', 'Выполнение функции приостанавливается, браузер ждёт сеть.'],
      ['3. Ответ получен', 'Promise.resolve → продолжение функции ставится в microtask queue.'],
      ['4. Продолжение', 'Код после await выполняется с результатом.'],
      ['5. Итог', 'Promise функции переходит в fulfilled.']
    ],
    cascade: [
      ['1. Сбор правил', 'Браузер собирает все CSS-правила, селекторы которых совпали с элементом.'],
      ['2. Специфичность', 'Считаем (id, class, tag). Например #app .btn → (1,1,0).'],
      ['3. Порядок', 'При равной специфичности побеждает правило ниже в файле.'],
      ['4. !important', 'Перебивает обычные правила (но не стоит злоупотреблять).'],
      ['5. Наследование', 'Часть свойств (color, font) наследуется от родителя.']
    ],
    dom: [
      ['1. HTML → парсер', 'Браузер читает теги и строит дерево узлов (DOM).'],
      ['2. CSSOM', 'Параллельно строится дерево стилей.'],
      ['3. Render tree', 'DOM + CSSOM = дерево отрисовки (без display:none).'],
      ['4. Layout', 'Расчёт размеров и позиций.'],
      ['5. Paint / Composite', 'Рисование пикселей и слоёв на экране.']
    ],
    algo: [
      ['1. Инициализация', 'let sum = 0; const items = [1,2,3];'],
      ['2. Шаг 1', 'sum = 1'],
      ['3. Шаг 2', 'sum = 3'],
      ['4. Шаг 3', 'sum = 6'],
      ['5. Результат', 'return 6 — сложность O(n).']
    ]
  };
  const steps = scenes[kind] || scenes.loop;
  box.innerHTML = `<div class="list-rows">${steps.map((s, i) => `<div class="list-row viz-step" data-i="${i}" style="opacity:.45;transition:.3s">
    <b style="width:22px;height:22px;border-radius:8px;background:var(--accent);color:#fff;display:grid;place-items:center">${i + 1}</b>
    <div class="grow"><b>${esc(s[0])}</b><small>${esc(s[1])}</small></div></div>`).join('')}</div>
    <div class="rowflex mt8"><button class="mini-btn" id="vizPlay">${icon('play', 13)} Проиграть</button>
      <button class="mini-btn" id="vizNext">Шаг ${icon('arrowRight', 13)}</button><span class="muted" id="vizStatus" style="font-size:11px"></span></div>`;
  let i = -1;
  const show = n => {
    i = n; box.querySelectorAll('.viz-step').forEach((s, j) => s.style.opacity = j <= n ? '1' : '.45');
    box.querySelector('#vizStatus').textContent = n < 0 ? 'Готово к запуску' : `Шаг ${n + 1} из ${steps.length}`;
  };
  box.querySelector('#vizNext').onclick = () => show((i + 1) % steps.length);
  box.querySelector('#vizPlay').onclick = () => { let n = 0; show(0); const t = setInterval(() => { n++; if (n >= steps.length) clearInterval(t); else show(n); }, 900); };
  show(-1);
}

/* ══════════════════ plugins ══════════════════ */
export const pluginAPI = {
  state, toast, emit, on, insertText, setDoc, getDoc, readFile: p => state.files[p]?.content || '',
  writeFile: (p, c) => ctx.runCommand('writeVirtual', { path: p, content: c }),
  runCommand: id => ctx.runCommand(id),
  analyze: () => runAnalysis(),
  version: '1.0'
};
export function initPlugins() {
  const host = $('#pluginsPanel'); if (!host) return;
  renderPlugins();
}
export function renderPlugins() {
  const host = $('#pluginsPanel'); if (!host) return;
  host.innerHTML = `<div class="rowflex mb8"><span class="pill pill-accent"> ${state.plugins.length} активно</span>
    <button class="mini-btn" id="plugUrl">По ссылке</button></div><div class="list-rows" id="plugList"></div>
    <div class="beginner mt8"><b>API для плагинов:</b> window.Runlet.pluginAPI — state, toast, emit, on, insertText, setDoc, getDoc, analyze(). Плагины запускаются в песочнице без доступа к файлам ОС.</div>`;
  const list = host.querySelector('#plugList');
  for (const p of PLUGIN_CATALOG) {
    const active = state.plugins.includes(p.id);
    const row = el('div', { class: 'list-row' },
      el('div', { class: 'pr-ico', html: icon(p.icon || 'puzzle', 17) }),
      el('div', { class: 'grow' }, el('b', { text: p.name }), el('small', { text: p.desc })),
      el('button', { class: 'mini-btn' + (active ? ' active' : ''), text: active ? 'Открыть' : 'Включить' }));
    row.querySelector('button').onclick = () => {
      if (!active) { state.plugins.push(p.id); toast(`Плагин «${p.name}» включён`, 'ok'); renderPlugins(); }
      openPlugin(p.id);
    };
    list.appendChild(row);
  }
  host.querySelector('#plugUrl').onclick = () => ctx.modal({
    title: 'Установить плагин по ссылке',
    body: `<div class="field"><label>URL JS-файла (только HTTPS)</label><input id="plugSrc" placeholder="https://example.com/plugin.js"></div>
      <div class="beginner"> Сторонний код выполняется в отдельном sandboxed iframe без доступа к DOM редактора, файлам ОС и сети. Разрешены только явно описанные команды.</div>`,
    okText: 'Установить',
    onOk: async root => {
      const url = root.querySelector('#plugSrc').value.trim(); if (!url) return false;
      let u;
      try { u = new URL(url); } catch (_) { toast('Некорректный URL', 'err'); return false; }
      if (u.protocol !== 'https:' || u.username || u.password || url.length > 2000) {
        toast('Разрешены только HTTPS-ссылки без логина/пароля', 'err'); return false;
      }
      try {
        const res = await fetch(u.href, { credentials: 'omit', referrerPolicy: 'no-referrer' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const code = await res.text();
        if (code.length > 200000) throw new Error('файл плагина слишком большой (>200 КБ)');
        installPluginCode(code, u.hostname);
      } catch (e) { toast('Не удалось загрузить плагин: ' + e.message, 'err'); }
    }
  });
}
/* Commands a remote plugin is allowed to expose as a menu entry. */
const PLUGIN_SAFE_COMMANDS = new Set([
  'run', 'analyze', 'format', 'save', 'theme', 'density', 'palette', 'snippets',
  'cssLab', 'jsTools', 'htmlTools', 'colorTool', 'contrastTool', 'tour', 'learn',
  'features', 'plugins', 'librarySearch', 'consoleClear', 'refreshInspectors',
  'breakpoint', 'rotateDevice', 'toggleGrid', 'previewFullscreen', 'bundleSize',
  'perfTips', 'lighthouse', 'a11yReport', 'screenReader'
]);
const PLUGIN_SAFE_METHODS = new Set([
  'toast', 'log', 'emit', 'insertText', 'setDoc', 'getDoc', 'analyze',
  'runCommand', 'readFile', 'writeFile'
]);

/** Remote plugin code runs in a separate sandboxed iframe (opaque origin,
 *  CSP connect-src 'none'). It can only call a curated, validated message API. */
export function installPluginCode(code, name = 'custom') {
  if (typeof code !== 'string' || !code.trim() || code.length > 200000 || code.includes('\0')) {
    toast('Некорректный код плагина', 'err'); return false;
  }
  const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const iframe = document.createElement('iframe');
  iframe.setAttribute('sandbox', 'allow-scripts');   // NO allow-same-origin
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText = 'position:fixed;left:-9999px;width:1px;height:1px;border:0;opacity:0';

  const cfg = {
    nonce,
    code,
    files: Object.keys(state.files).slice(0, 100).map(p => String(p).slice(0, 200)),
    projectName: String(state.projectName).slice(0, 100),
    methods: [...PLUGIN_SAFE_METHODS],
    safeCommands: [...PLUGIN_SAFE_COMMANDS]
  };
  const shim = `(function(){
    var C = window.__PLUGIN_CFG__;
    var post = function(m){ try { parent.postMessage(Object.assign({__plugin:1, nonce:C.nonce}, m), '*'); } catch(e){} };
    var api = {};
    C.methods.forEach(function(m){ api[m] = function(){
      var args = [].slice.call(arguments).slice(0, 4).map(function(a){
        if (typeof a === 'string') return a.slice(0, 200000);
        if (typeof a === 'number' || typeof a === 'boolean' || a === null) return a;
        return String(a).slice(0, 1000);
      });
      post({ method: m, args: args });
    }; });
    api.state = Object.freeze({ files: Object.freeze(C.files.slice()), projectName: C.projectName,
                                safeCommands: Object.freeze(C.safeCommands.slice()) });
    api.version = '1.0';
    try {
      var fn = new Function('api', 'console', '"use strict";\n' + C.code +
        '\nreturn (typeof register === "function") ? register(api) : null;');
      var manifest = fn(api, { log: function(){}, warn: function(){}, error: function(){}, info: function(){} });
      var clean = null;
      try { clean = JSON.parse(JSON.stringify(manifest || {})); } catch(e) { clean = null; }
      post({ ready: true, manifest: clean });
    } catch (e) { post({ error: String((e && e.message) || e).slice(0, 300) }); }
  })();`;
  const cfgJson = JSON.stringify(cfg).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  iframe.srcdoc = '<!doctype html><html><head><meta charset="utf-8">' +
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; connect-src 'none'; img-src 'none'; style-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'">` +
    '</head><body><script>window.__PLUGIN_CFG__=' + cfgJson + ';<\/script><script>' + shim + '<\/script></body></html>';

  let done = false;
  const cleanup = () => {
    if (done) return; done = true;
    window.removeEventListener('message', handler);
    clearTimeout(killTimer);
    setTimeout(() => iframe.remove(), 50);
  };
  const killTimer = setTimeout(cleanup, 30000);

  function handler(e) {
    const d = e.data;
    if (!d || d.__plugin !== 1 || d.nonce !== nonce) return;
    if (e.source !== iframe.contentWindow) return;
    if (e.origin !== 'null' && e.origin !== location.origin) return;
    if (d.error) { toast('Ошибка плагина: ' + String(d.error).slice(0, 200), 'err'); cleanup(); return; }
    if (d.ready) {
      const m = d.manifest && typeof d.manifest === 'object' ? d.manifest : {};
      const pname = typeof m.name === 'string' ? m.name.replace(/[^\w\s.-]/g, '').slice(0, 60) : '';
      const cmds = m.commands && typeof m.commands === 'object' && !Array.isArray(m.commands) ? m.commands : {};
      let registered = 0;
      for (const [id, def] of Object.entries(cmds).slice(0, 20)) {
        if (!/^[\w-]{1,60}$/.test(id) || !def || typeof def !== 'object') continue;
        const target = String(def.command || '').slice(0, 80);
        if (!PLUGIN_SAFE_COMMANDS.has(target)) continue;
        const title = String(def.title || id).replace(/[<>&"']/g, '').slice(0, 80);
        ctx.registerCommand?.('plugin:' + id, {
          title, group: 'Плагины', icon: '', run: () => ctx.runCommand?.(target)
        });
        registered++;
      }
      if (pname) state.plugins.push(pname);
      toast(`Плагин «${pname || name}» установлен (${registered} команд)`, 'ok');
      renderPlugins(); cleanup(); return;
    }
    if (typeof d.method === 'string' && PLUGIN_SAFE_METHODS.has(d.method)) {
      executePluginMethod(d.method, Array.isArray(d.args) ? d.args : []);
    }
  }
  window.addEventListener('message', handler);
  document.body.appendChild(iframe);
  return true;
}
function executePluginMethod(method, args) {
  const str = (v, n = 200000) => typeof v === 'string' ? v.slice(0, n) : String(v ?? '').slice(0, n);
  try {
    switch (method) {
      case 'toast': case 'log': toast(str(args[0], 300), 'info', 'Плагин'); break;
      case 'emit': if (/^[\w:.-]{1,60}$/.test(str(args[0], 60))) emit(str(args[0], 60), args[1]); break;
      case 'insertText': insertText(str(args[0]), str(args[1], 10) || state.activePane); break;
      case 'setDoc': setDoc(str(args[0]), str(args[1], 10) || state.activePane); break;
      case 'getDoc': break;                // async read not exposed to remote plugins
      case 'analyze': runAnalysis({ silent: true }); break;
      case 'readFile': break;              // no synchronous file read across the boundary
      case 'writeFile': {
        const path = str(args[0], 300);
        if (/^[\w./-]{1,300}$/.test(path) && !path.includes('..')) write(path, str(args[1]));
        break;
      }
      case 'runCommand': {
        const id = str(args[0], 80);
        if (PLUGIN_SAFE_COMMANDS.has(id)) ctx.runCommand?.(id);
        break;
      }
    }
  } catch (e) { toast('Плагин: ' + e.message, 'err'); }
}
export function openPlugin(id) {
  switch (id) {
    case 'terminal': return pluginTerminal();
    case 'calc': return pluginCalc();
    case 'regex': return pluginRegex();
    case 'units': return pluginUnits();
    case 'notes': return pluginNotes();
    case 'pomodoro': return pluginPomodoro();
    case 'themes': return pluginThemes();
    case 'diagram': return pluginDiagram();
    default: toast('Плагин не найден', 'warn');
  }
}
function pluginTerminal() {
  ctx.modal({ title: 'Терминал Runlet', wide: true,
    body: `<div id="termOut" style="height:280px;overflow:auto;background:var(--code-bg);border-radius:12px;padding:12px;font:12px var(--mono)">Runlet terminal 1.0 — введите help\n</div>
      <div class="repl-bar"><span class="repl-prompt">$</span><input id="termIn" placeholder="help" style="flex:1;font:12px var(--mono)"><button class="mini-btn" id="termRun">↵</button></div>`,
    okText: 'Закрыть',
    onMount: root => {
      const out = root.querySelector('#termOut'), inp = root.querySelector('#termIn');
      const print = s => { const row = document.createElement('div'); row.textContent = String(s).slice(0, 4000); out.appendChild(row); while (out.children.length > 300) out.removeChild(out.firstChild); out.scrollTop = out.scrollHeight; };
      const run = () => {
        const line = inp.value.trim(); if (!line) return;
        print('$ ' + line); inp.value = '';
        const [cmd, ...args] = line.split(/\s+/);
        if (cmd === 'help') print('Команды: ls, cat <file>, analyze, run, clear, files, size, echo <text>, theme <dark|light|contrast>');
        else if (cmd === 'ls' || cmd === 'files') print(Object.keys(state.files).join('\n'));
        else if (cmd === 'cat') print((state.files[args[0]]?.content || 'нет файла').slice(0, 2000));
        else if (cmd === 'analyze') { runAnalysis(); print('Анализ запущен → вкладка «Анализ»'); }
        else if (cmd === 'run') { ctx.runCommand('run'); print('Предпросмотр обновлён'); }
        else if (cmd === 'clear') out.innerHTML = '';
        else if (cmd === 'size') print(Object.values(state.files).reduce((n, f) => n + f.content.length, 0) + ' символов');
        else if (cmd === 'theme') { state.settings.theme = args[0] || 'dark'; ctx.runCommand('applySettings'); print('Тема: ' + state.settings.theme); }
        else if (cmd === 'echo') print(args.join(' '));
        else print('Неизвестная команда: ' + cmd);
      };
      root.querySelector('#termRun').onclick = run;
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') run(); });
      inp.focus();
    } });
}
function pluginCalc() {
  ctx.modal({ title: 'Калькулятор', narrow: true,
    body: `<div class="field"><label>Выражение</label><input id="calcIn" value="(16 * 2 + 8) / 2"></div>
      <div id="calcOut" class="gen-preview" style="color:var(--text);background:var(--card-2)">18</div>
      <div class="rowflex"><button class="mini-btn" data-e="px">px→rem</button><button class="mini-btn" data-e="rem">rem→px</button></div>`,
    okText: 'Закрыть',
    onMount: root => {
      const inp = root.querySelector('#calcIn'), out = root.querySelector('#calcOut');
      const update = () => { try { out.textContent = '= ' + safeCalc(inp.value); } catch (e) { out.textContent = 'Ошибка: ' + e.message; } };
      inp.addEventListener('input', update); update();
      root.querySelectorAll('[data-e]').forEach(b => b.onclick = () => {
        const n = parseFloat(inp.value) || 16;
        inp.value = b.dataset.e === 'px' ? `${n}px = ${n / 16}rem` : `${n}rem = ${n * 16}px`;
        out.textContent = inp.value;
      });
    } });
}
function pluginRegex() {
  ctx.modal({ title: 'Генератор regex', narrow: true,
    body: `<div class="field"><label>Что ищем</label><select id="rgxType" class="field"><option value="email">E-mail</option><option value="phone">Телефон РФ</option><option value="url">URL</option><option value="hex">HEX-цвет</option><option value="date">Дата ДД.ММ.ГГГГ</option><option value="cyr">Кириллица</option></select></div>
      <div class="field"><label>Шаблон</label><input id="rgxOut" readonly></div><div class="field"><label>Тест</label><input id="rgxTest" value="test@example.com"></div>
      <div id="rgxRes" class="gen-preview" style="background:var(--card-2);color:var(--text)"></div>`,
    okText: 'Скопировать',
    onOk: root => copy(root.querySelector('#rgxOut').value),
    onMount: root => {
      const presets = { email: '^[\\w.+-]+@[\\w-]+\\.[\\w.-]{2,}$', phone: '^(\\+7|8)[\\s(-]?\\d{3}[\\s)-]?\\d{3}[\\s-]?\\d{2}[\\s-]?\\d{2}$', url: 'https?:\\/\\/[\\w.-]+(?:\\:[0-9]+)?(?:\\/[\\w./?%&=-]*)?', hex: '^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$', date: '^\\d{2}\\.\\d{2}\\.\\d{4}$', cyr: '^[А-Яа-яЁё\\s-]+$' };
      const upd = () => {
        const p = presets[root.querySelector('#rgxType').value];
        root.querySelector('#rgxOut').value = '/' + p + '/';
        try { root.querySelector('#rgxRes').textContent = new RegExp(p).test(root.querySelector('#rgxTest').value) ? ' Совпадает' : ' Не совпадает'; }
        catch (e) { root.querySelector('#rgxRes').textContent = e.message; }
      };
      root.querySelectorAll('#rgxType,#rgxTest').forEach(x => x.addEventListener('input', upd)); upd();
    } });
}
function pluginUnits() {
  ctx.modal({ title: 'Конвертер единиц', narrow: true,
    body: `<div class="field-row"><div class="field"><label>Значение</label><input id="uVal" type="number" value="16"></div>
      <div class="field"><label>Из</label><select id="uFrom"><option>px</option><option>rem</option><option>em</option><option>%</option></select></div>
      <div class="field"><label>В</label><select id="uTo"><option>rem</option><option>px</option><option>em</option><option>%</option></select></div></div>
      <div id="uOut" class="gen-preview" style="background:var(--card-2);color:var(--text)">= 1rem</div>`,
    okText: 'Вставить результат',
    onOk: root => { insertText(root.querySelector('#uOut').textContent.replace('= ', '')); },
    onMount: root => {
      const upd = () => { root.querySelector('#uOut').textContent = '= ' + unitConvert(root.querySelector('#uVal').value, root.querySelector('#uFrom').value, root.querySelector('#uTo').value); };
      root.querySelectorAll('input,select').forEach(x => x.addEventListener('input', upd)); upd();
    } });
}
function pluginNotes() {
  const key = 'runlet:plugin:notes';
  const saved = localStorage.getItem(key) || '# Заметки\n\n- Записать идеи по проекту\n';
  ctx.modal({ title: 'Заметки', wide: true,
    body: `<textarea id="notesArea" style="width:100%;height:320px;border:1px solid var(--border);border-radius:12px;background:var(--code-bg);padding:12px;font:13px var(--mono)">${esc(saved)}</textarea>`,
    okText: 'Сохранить',
    onOk: root => { localStorage.setItem(key, root.querySelector('#notesArea').value); toast('Заметки сохранены', 'ok'); } });
}
function pluginPomodoro() {
  ctx.modal({ title: 'Помодоро', narrow: true,
    body: `<div style="text-align:center"><div id="pomoTime" style="font-size:58px;font-weight:800;letter-spacing:-3px">25:00</div>
      <div class="muted">Работа 25 мин / отдых 5 мин</div>
      <div class="rowflex mt8" style="justify-content:center"><button class="mini-btn" id="pomoStart">${icon('play', 13)} Старт</button>
      <button class="mini-btn" id="pomoReset">${icon('refresh', 13)} Сброс</button></div></div>`,
    okText: 'Закрыть',
    onMount: root => {
      let left = 25 * 60, timer = null;
      const out = root.querySelector('#pomoTime');
      const draw = () => out.textContent = `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`;
      root.querySelector('#pomoStart').onclick = () => {
        if (timer) { clearInterval(timer); timer = null; return; }
        timer = setInterval(() => { left--; draw(); if (left <= 0) { clearInterval(timer); timer = null; toast('Помодоро завершён — отдохните!', 'ok'); } }, 1000);
      };
      root.querySelector('#pomoReset').onclick = () => { clearInterval(timer); timer = null; left = 25 * 60; draw(); };
      draw();
    } });
}
function pluginThemes() {
  ctx.modal({ title: 'Генератор темы', narrow: true,
    body: `<div class="field"><label>Базовый цвет</label><input type="color" id="thColor" value="#7c6cf6"></div>
      <div id="thSwatches" class="rowflex"></div><pre id="thCss" style="font:11px var(--mono);background:var(--code-bg);padding:10px;border-radius:12px;margin-top:10px"></pre>`,
    okText: 'Применить акцент',
    onOk: root => { state.settings.accent = root.querySelector('#thColor').value; ctx.runCommand('applySettings'); },
    onMount: root => {
      const upd = () => {
        const c = root.querySelector('#thColor').value, p = paletteFrom(c, 6);
        root.querySelector('#thSwatches').innerHTML = p.map(x => `<div style="width:40px;height:40px;border-radius:12px;background:${x}" title="${x}"></div>`).join('');
        root.querySelector('#thCss').textContent = `:root {\n${p.map((x, i) => `  --brand-${i + 1}: ${x};`).join('\n')}\n  --accent: ${c};\n}`;
      };
      root.querySelector('#thColor').addEventListener('input', upd); upd();
    } });
}
function pluginDiagram() {
  ctx.modal({ title: 'Диаграмма', narrow: true,
    body: `<div class="field"><label>Узлы (через ->)</label><input id="dgIn" value="HTML -> CSSOM -> Render tree -> Layout -> Paint"></div>
      <div id="dgOut" class="gen-preview" style="background:var(--card-2);color:var(--text);height:auto;min-height:120px;flex-direction:column;gap:6px"></div>`,
    okText: 'Вставить Mermaid',
    onOk: root => insertText('```mermaid\ngraph LR\n' + root.querySelector('#dgIn').value.split('->').map((s, i, a) => i ? `  N${i - 1} --> N${i}[${s.trim()}]` : `  N0[${s.trim()}]`).join('\n') + '\n```'),
    onMount: root => {
      const upd = () => {
        const parts = root.querySelector('#dgIn').value.split('->');
        root.querySelector('#dgOut').innerHTML = parts.map((s, i) => `<div style="padding:8px 14px;border-radius:12px;background:var(--accent);color:#fff">${esc(s.trim())}</div>${i < parts.length - 1 ? `<div style="text-align:center;color:var(--accent)">${icon('chevronDown', 16)}</div>` : ''}`).join('');
      };
      root.querySelector('#dgIn').addEventListener('input', upd); upd();
    } });
}

/* ══════════════════ 500 ideas coverage ══════════════════ */
export function initFeatures() {
  const host = $('#featuresPanel'); if (!host) return;
  const c = coverage();
  host.innerHTML = `<div class="beginner" style="margin:0 0 10px"><b>Карта идей: ${c.done} реализовано, ${c.partial} частично, всего ${c.total}.</b><br>
    <div class="progress mt8"><i style="width:${c.percent}%"></i></div>
    <small class="dim"> сделано ·  частично ·  в планах</small></div>
    <input id="featFilter" placeholder="Фильтр по названию…" style="width:100%;height:29px;border-radius:9px;border:1px solid var(--border);background:var(--code-bg);padding:0 9px;margin-bottom:8px">
    <div id="featList"></div>`;
  const list = host.querySelector('#featList');
  const draw = q => {
    list.innerHTML = '';
    for (const cat of FEATURES) {
      const items = cat.items.map((name, i) => ({ n: cat.from + i, name })).filter(x => !q || x.name.toLowerCase().includes(q.toLowerCase()));
      if (!items.length) continue;
      const d = items.filter(x => IMPLEMENTED.has(x.n)).length;
      const box = el('div', { class: 'feat-cat' },
        el('h4', {}, cat.name, el('span', { class: 'cov', text: `${d}/${items.length}` })));
      const grid = el('div', { class: 'feat-grid' });
      for (const it of items) {
        const cls = IMPLEMENTED.has(it.n) ? 'done' : PARTIAL_SET.has(it.n) ? 'partial' : '';
        grid.appendChild(el('span', { class: 'feat-item ' + cls, title: `${it.n}. ${it.name} — ${cls === 'done' ? 'реализовано' : cls === 'partial' ? 'частично' : 'в планах'}`, text: `${it.n}. ${it.name}` }));
      }
      box.appendChild(grid); list.appendChild(box);
    }
  };
  draw('');
  host.querySelector('#featFilter').addEventListener('input', debounce(e => draw(e.target.value), 150));
}
