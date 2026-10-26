/* Inspector panels: analysis, console, debugger, DOM, network, storage, perf, log. */
import { state, ctx, $, $$, el, esc, on, emit, toast, download, copy, debounce, fmtBytes, sanitizeColor } from './core.js';
import { icon } from './icons.js';
import { read, listFiles } from './state.js';
import { reportMarkdown, reportJSON, gotoDiagnostic, applyFix, fixAllSafe, runAnalysis, scheduleAnalysis } from './analyzer.js';
import { refreshInspectors, request, send, evalInPreview, setBreakpoint, emulateA11y, screenReader } from './preview.js';
import { contrast, contrastVerdict, perfTips, securityScan } from './tools.js';
import { getSelection } from './editor.js';

let diagFilter = 'all';
let consoleHistory = [];
let consoleHistIdx = -1;
let beginnerMode = false;

export function initPanels() {
  on('analysis:report', renderAnalysis);
  on('console:log', () => renderConsole());
  on('console:clear', () => renderConsole());
  on('activity', renderLog);
  on('network', renderNetwork);
  on('network-all', renderNetwork);
  on('storage', renderStorage);
  on('storage-all', renderStorage);
  on('dom', renderDom);
  on('styles', renderDom);
  on('listeners', renderDom);
  on('perf', renderPerf);
  on('trace', renderDebug);
  on('breakpoint', renderDebug);
  on('breakpoints', renderDebug);
  on('a11y:scan', showA11yScan);
  on('element:select', renderDom);
  renderConsole(); renderDebug(); renderNetwork(); renderStorage(); renderDom(); renderPerf(); renderLog();
  // periodically refresh live inspectors
  setInterval(() => {
    const active = $('.insp-tab.active')?.dataset.inspTab;
    if (['dom', 'network', 'storage', 'perf', 'debug'].includes(active)) refreshInspectors();
  }, 4000);
  renderAnalysis();
}

/* ══════════════════ analysis ══════════════════ */
export function renderAnalysis() {
  const host = $('#analysisPanel'); if (!host) return;
  const r = state.report;
  if (!r) {
    host.innerHTML = `<div class="analysis-hero"><div class="score-ring" style="--score:0"><span class="num">—</span></div>
      <div class="analysis-hero-text"><h2>Что делает ваш код?</h2>
      <p class="analysis-desc">Нажмите «Анализ кода» — Python-движок разберёт HTML, CSS и JS, объяснит поведение и найдёт ошибки.</p>
      <div class="engine-line"><button class="mini-btn" data-cmd="analyze">▶ Запустить анализ</button><span>Ctrl+Shift+A</span></div></div></div>
      <div class="section"><h3>Как это работает</h3><div class="steps">
      <div class="step"><span class="step-i">1</span><div>Движок читает все файлы проекта и строит карту: теги, id, селекторы, функции.</div></div>
      <div class="step"><span class="step-i">2</span><div>Сопоставляет <code class="inline">querySelector('#id')</code> с реальной разметкой — и находит будущие <code class="inline">TypeError</code>.</div></div>
      <div class="step"><span class="step-i">3</span><div>Собирает поведение: события, fetch, таймеры, localStorage — и пишет понятное резюме.</div></div></div></div>`;
    return;
  }
  const py = r.engine?.startsWith('runlet-python');
  host.innerHTML = `
    <div class="analysis-hero">
      <div class="score-ring" style="--score:${r.score}"><span class="num">${r.score}</span><span class="lbl">/ 100</span></div>
      <div class="analysis-hero-text">
        <span class="verdict ${r.summary.verdict_level}">${esc(r.summary.verdict)}</span>
        <h2>${esc(r.summary.headline)}</h2>
        <p class="analysis-desc">${esc(r.summary.description)}</p>
        <div class="engine-line"><span class="pill ${py ? 'pill-accent' : ''}">${icon(py ? 'code' : 'info', 12)} ${py ? 'Python-движок' : 'JS-анализ'}</span>
          <span>${r.elapsed_ms} мс</span><span>${r.diagnostics.length} замечаний</span>
          <button class="mini-btn" data-cmd="analyze">${icon('refresh', 12)} Обновить</button>
          <button class="mini-btn" data-cmd="analysisReport">${icon('maximize', 12)} Развернуть</button></div>
      </div>
    </div>
    <div class="grade-bars">${Object.entries(r.grades).map(([k, v]) => `
      <div class="grade"><span>${gradesRu[k] || k}</span><b>${v}</b><div class="bar"><i style="width:${v}%"></i></div></div>`).join('')}</div>
    <div class="section"><h3>Что произойдёт при запуске <span class="count">${r.summary.steps.length} шагов</span></h3>
      <div class="steps">${r.summary.steps.map((s, i) => `<div class="step"><span class="step-i">${s.icon === 'error' ? '!' : i + 1}</span>
        <div>${esc(s.text)}<span class="conf">${esc(s.confidence)}</span></div></div>`).join('')}</div></div>
    <div class="section"><h3>Ошибки и замечания <span class="count">${r.diagnostics.length}</span></h3>
      <div class="sev-filters">${['all', 'error', 'warning', 'info', 'hint'].map(f =>
        `<button class="sev-chip ${diagFilter === f ? 'active' : ''}" data-sev="${f}">${sevRu[f]} <span class="n">${f === 'all' ? r.diagnostics.length : r.diagnostics.filter(d => d.sev === f).length}</span></button>`).join('')}
        <button class="sev-chip" data-cmd="fixAll">${icon('wand', 12)} Исправить</button></div>
      <div class="diag-list">${diagnosticsHtml(r)}</div></div>
    ${chipsHtml(r)}
    <div class="section"><h3>Для новичка <button class="mini-btn" id="beginnerToggle" style="margin-left:auto">${beginnerMode ? 'Скрыть' : 'Объяснить'}</button></h3>
      <div class="beginner ${beginnerMode ? '' : 'hidden'}" id="beginnerBox"><ul>${r.summary.beginner.map(b => `<li>${esc(b)}</li>`).join('')}</ul></div></div>
    <div class="rowflex" style="padding:0 14px 14px">
      <button class="mini-btn" data-cmd="exportReportMd">${icon('download', 12)} Markdown</button>
      <button class="mini-btn" data-cmd="exportReportJson">${icon('download', 12)} JSON</button>
      <button class="mini-btn" data-cmd="copyReport">${icon('copy', 12)} Копировать</button>
      <button class="mini-btn" data-cmd="helpWelcome">${icon('help', 12)} Как работать</button>
      </div>`;
  host.querySelectorAll('[data-sev]').forEach(b => b.addEventListener('click', () => { diagFilter = b.dataset.sev; renderAnalysis(); }));
  host.querySelectorAll('.diag-top .file').forEach(b => b.addEventListener('click', () => {
    const d = r.diagnostics.find(x => x.id === b.dataset.rid && x.line === +b.dataset.line);
    if (d) gotoDiagnostic(d);
  }));
  host.querySelectorAll('[data-fix]').forEach(b => b.addEventListener('click', () => {
    const d = r.diagnostics.find(x => x.id === b.dataset.fix && x.line === +b.dataset.line);
    if (d) applyFix(d);
  }));
  host.querySelectorAll('.diag-msg').forEach(n => n.addEventListener('click', () => n.parentElement.querySelector('.diag-why')?.classList.toggle('hidden')));
  $('#beginnerToggle')?.addEventListener('click', () => { beginnerMode = !beginnerMode; renderAnalysis(); });
}
const gradesRu = { correctness: 'корректность', a11y: 'доступность', seo: 'SEO', perf: 'перфоманс', security: 'безопасность', style: 'стиль' };
const sevRu = { all: 'все', error: 'ошибки', warning: 'предупр.', info: 'инфо', hint: 'советы' };
function diagnosticsHtml(r) {
  const list = r.diagnostics.filter(d => diagFilter === 'all' || d.sev === diagFilter);
  if (!list.length) return '<div class="empty-note">Здесь чисто </div>';
  return list.slice(0, 90).map(d => `<div class="diag ${d.sev}">
    <div class="diag-top"><span class="sev ${d.sev}">${({ error: 'ОШИБКА', warning: 'ВНИМАНИЕ', info: 'ИНФО', hint: 'СОВЕТ' })[d.sev]}</span>
      <span>${esc(d.id)} · ${esc(gradesRu[d.cat] || d.cat)}</span>
      <span class="file" data-rid="${esc(d.id)}" data-line="${d.line}">${esc(d.file)}:${d.line} ↗</span></div>
    <p class="diag-msg">${esc(d.msg)}</p>
    ${d.why ? `<div class="diag-why hidden"><b>Почему:</b> ${esc(d.why)}</div>` : ''}
    ${d.fix ? `<div class="diag-fix"> ${esc(d.fix)}</div>` : ''}
    <div class="diag-actions">${d.edit ? `<button class="mini-btn" data-fix="${esc(d.id)}" data-line="${d.line}">Исправить</button>` : ''}
      <button class="mini-btn" data-cmd="gotoDiag" data-rid="${esc(d.id)}" data-line="${d.line}">К строке</button>
      <button class="mini-btn" data-cmd="explainDiag" data-rid="${esc(d.id)}" data-line="${d.line}">Объяснить</button></div>
  </div>`).join('') + (list.length > 90 ? `<div class="empty-note">…и ещё ${list.length - 90}. Откройте полный отчёт.</div>` : '');
}
function chipsHtml(r) {
  const b = r.behavior || {};
  const chips = [];
  for (const e of (b.events || []).slice(0, 6)) chips.push(`<span class="chip"> <b>${esc(e.type)}</b> → ${esc(e.target)}</span>`);
  for (const n of (b.network || []).slice(0, 4)) chips.push(`<span class="chip"> <b>${esc(n.method || 'fetch')}</b> ${esc(String(n.url).slice(0, 40))}</span>`);
  for (const t of (b.timers || []).slice(0, 3)) chips.push(`<span class="chip">⏱ ${esc(t.kind || 'timer')}</span>`);
  for (const s of (b.storage || []).slice(0, 4)) chips.push(`<span class="chip"> <b>${esc(s.store)}</b> ${esc(s.key)}</span>`);
  for (const c of (b.colors || []).slice(0, 6)) {
    const col = sanitizeColor(c.value, 'transparent');
    chips.push(`<span class="chip"> <b style="color:${col}">■</b> ${esc(String(c.value).slice(0, 40))}</span>`);
  }
  if (!chips.length) return '';
  return `<div class="section"><h3>Поведение кода</h3><div class="chips">${chips.join('')}</div></div>`;
}

export function fullAnalysisReport() {
  const r = state.report;
  ctx.modal({
    title: ' Полный анализ кода', wide: true,
    body: `<div id="fullReport" class="analysis-report">${r ? reportBody(r) : '<div class="empty-note">Сначала запустите анализ</div>'}</div>`,
    okText: 'Закрыть',
    onMount: root => {
      root.querySelectorAll('[data-sev]').forEach(b => b.addEventListener('click', () => { diagFilter = b.dataset.sev; root.querySelector('#fullReport').innerHTML = reportBody(state.report); }));
      root.querySelectorAll('[data-fix]').forEach(b => b.addEventListener('click', () => applyFix(state.report.diagnostics.find(d => d.id === b.dataset.fix && d.line === +b.dataset.line))));
    }
  });
  return r;
}
function reportBody(r) {
  return `<div class="analysis-hero">
      <div class="score-ring" style="--score:${r.score}"><span class="num">${r.score}</span><span class="lbl">из 100</span></div>
      <div class="analysis-hero-text"><span class="verdict ${r.summary.verdict_level}">${esc(r.summary.verdict)}</span>
        <h2>${esc(r.summary.headline)}</h2><p class="analysis-desc">${esc(r.summary.description)}</p>
        <div class="engine-line"><span class="pill pill-accent">${esc(r.engine)}</span><span>${r.elapsed_ms} мс</span>
        <span>${r.metrics?.files || 0} файлов · ${r.metrics?.lines || 0} строк</span></div></div></div>
    <div class="grade-bars">${Object.entries(r.grades).map(([k, v]) => `<div class="grade"><span>${gradesRu[k] || k}</span><b>${v}</b><div class="bar"><i style="width:${v}%"></i></div></div>`).join('')}</div>
    <div class="section"><h3>Что скорее всего будет делать этот код</h3>
      <div class="steps">${r.summary.steps.map((s, i) => `<div class="step"><span class="step-i">${i + 1}</span><div>${esc(s.text)}<span class="conf">${esc(s.confidence)}</span></div></div>`).join('')}</div></div>
    ${chipsHtml(r)}
    <div class="section"><h3>Найденные ошибки: ${r.metrics?.diagnostics?.error || 0} ошибок, ${r.metrics?.diagnostics?.warning || 0} предупреждений</h3>
      <div class="sev-filters">${['all', 'error', 'warning', 'info', 'hint'].map(f => `<button class="sev-chip ${diagFilter === f ? 'active' : ''}" data-sev="${f}">${sevRu[f]}</button>`).join('')}</div>
      <div class="diag-list">${diagnosticsHtml(r)}</div></div>
    <div class="section"><h3>Метрики</h3><div class="grade-bars">
      ${metric('Файлов', r.metrics?.files || 0)}${metric('Строк', r.metrics?.lines || 0)}
      ${metric('CSS-правил', r.metrics?.css?.rules || 0)}${metric('Функций', r.functions?.length || 0)}
      ${metric('Событий', r.behavior?.events?.length || 0)}${metric('Битых ссылок', r.metrics?.broken_links || 0)}
      </div></div>
    <div class="section"><h3>Объяснение для новичка</h3><div class="beginner"><ul>${r.summary.beginner.map(b => `<li>${esc(b)}</li>`).join('')}</ul></div></div>
    <div class="section"><h3>Глоссарий</h3><div class="chips">${(r.glossary || []).slice(0, 12).map(g => `<span class="chip" title="${esc(g.meaning)}"><b>${esc(g.term)}</b></span>`).join('')}</div></div>`;
}
function metric(label, v) { return `<div class="grade"><span>${label}</span><b>${v}</b></div>`; }
export function exportReport(kind = 'md') {
  if (!state.report) { toast('Сначала запустите анализ', 'warn'); return; }
  download(`runlet-report.${kind}`, kind === 'md' ? reportMarkdown() : reportJSON(), kind === 'md' ? 'text/markdown' : 'application/json');
  toast('Отчёт сохранён', 'ok');
}

/* ══════════════════ console ══════════════════ */
export function renderConsole() {
  const host = $('#consolePanel'); if (!host) return;
  const levels = { all: 0, log: 0, info: 0, warn: 1, error: 2 };
  let logs = state.logs;
  if (state.consoleFilter !== 'all') logs = logs.filter(l => l.level === state.consoleFilter);
  if (state.consoleSearch) {
    try {
      const re = new RegExp(state.consoleSearch, 'i');
      logs = logs.filter(l => re.test(l.text || ''));
    } catch (e) { /* invalid regex */ }
  }
  if (!host.dataset.wired) {
    host.dataset.wired = '1';
    host.innerHTML = `<div class="insp-toolbar">
      <select id="logLevel" class="mini-select"><option value="all">все</option><option value="log">log</option><option value="info">info</option><option value="warn">warn</option><option value="error">error</option></select>
      <input id="logSearch" placeholder="Поиск / regex…" style="flex:1;min-width:70px;height:25px;border-radius:8px;border:1px solid var(--border);background:var(--code-bg);padding:0 8px;font-size:11px">
      <label class="chk"><input type="checkbox" id="logGroup" ${state.consoleGroup ? 'checked' : ''}> группировать</label>
      <button class="mini-btn" id="logClear">Очистить</button><button class="mini-btn" id="logSave"></button>
      <button class="mini-btn" id="logJson">JSON</button></div>
      <div class="console-list" id="logList" style="flex:1;overflow:auto"></div>
      <div class="repl-bar"><span class="repl-prompt">›</span><input id="replInput" placeholder="Введите JS-выражение (Enter — выполнить)" autocomplete="off">
      <button class="mini-btn" id="replRun">↵</button></div>`;
    host.querySelector('#logLevel').addEventListener('change', e => { state.consoleFilter = e.target.value; renderConsole(); });
    host.querySelector('#logSearch').addEventListener('input', debounce(e => { state.consoleSearch = e.target.value; renderConsole(); }, 200));
    host.querySelector('#logGroup').addEventListener('change', e => { state.consoleGroup = e.target.checked; renderConsole(); });
    host.querySelector('#logClear').addEventListener('click', () => { state.logs = []; renderConsole(); });
    host.querySelector('#logSave').addEventListener('click', () => download('runlet-console.txt', state.logs.map(l => `[${l.level}] ${l.text}`).join('\n'), 'text/plain'));
    host.querySelector('#logJson').addEventListener('click', () => download('runlet-console.json', JSON.stringify(state.logs, null, 2), 'application/json'));
    const input = host.querySelector('#replInput');
    const runExpr = async () => {
      const expr = input.value.trim(); if (!expr) return;
      consoleHistory.unshift(expr); consoleHistIdx = -1;
      state.logs.push({ level: 'input', text: '› ' + expr, args: [], time: Date.now() });
      const res = await evalInPreview(expr);
      if (res) {
        if (res.error) state.logs.push({ level: 'error', text: res.error, args: [], time: Date.now() });
        else state.logs.push({ level: 'result', text: res.value?.p || String(res.value), args: [res.value], time: Date.now() });
      } else state.logs.push({ level: 'error', text: 'Предпросмотр не отвечает', args: [], time: Date.now() });
      input.value = ''; renderConsole();
    };
    host.querySelector('#replRun').addEventListener('click', runExpr);
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); runExpr(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); consoleHistIdx = Math.min(consoleHistory.length - 1, consoleHistIdx + 1); input.value = consoleHistory[consoleHistIdx] || ''; }
      else if (e.key === 'ArrowDown') { e.preventDefault(); consoleHistIdx = Math.max(-1, consoleHistIdx - 1); input.value = consoleHistory[consoleHistIdx] || ''; }
    });
  }
  const list = host.querySelector('#logList'); if (!list) return;
  let rows = logs;
  if (state.consoleGroup) {
    const grouped = []; let last = null;
    for (const l of logs) {
      if (last && last.text === l.text && last.level === l.level) { last.count = (last.count || 1) + 1; continue; }
      last = { ...l, count: 1 }; grouped.push(last);
    }
    rows = grouped;
  }
  list.innerHTML = rows.slice(-400).map(l => {
    let extra = '';
    if (l.table) extra = `<table class="log-table"><tr>${Object.keys(l.table[0] || {}).map(k => `<th>${esc(k)}</th>`).join('')}</tr>${l.table.map(row => `<tr>${Object.values(row).map(v => `<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</table>`;
    else if (l.args?.length && typeof l.args[0] === 'object' && l.args[0]?.k === 'array') extra = `<div class="log-obj">▶ ${esc(l.args[0].p)}</div>`;
    if (l.stack) extra += `<div style="color:var(--dim);font-size:9px;white-space:pre-wrap">${esc(l.stack.slice(0, 400))}</div>`;
    return `<div class="log-row ${l.level}"><span class="lvl">${esc(l.level)}</span>
      <span class="txt">${esc(l.text || '')}${extra}</span>
      ${l.line ? `<span class="src">:${l.line}</span>` : ''}${l.count > 1 ? `<span class="cnt">×${l.count}</span>` : ''}
      <button class="mini-btn" style="height:18px;padding:0 5px" data-copy="${esc((l.text || '').slice(0, 200))}">⧉</button></div>`;
  }).join('') || '<div class="empty-note">Консоль пуста. <code>console.log("привет")</code> появится здесь.</div>';
  list.querySelectorAll('[data-copy]').forEach(b => b.addEventListener('click', () => { copy(b.dataset.copy); toast('Скопировано', 'ok'); }));
  list.scrollTop = list.scrollHeight;
  const n = $('#consoleCount'); if (n) n.textContent = state.logs.length;
}

/* ══════════════════ debugger (trace based) ══════════════════ */
export function renderDebug() {
  const host = $('#debugPanel'); if (!host) return;
  const bps = Object.entries(state.breakpoints).flatMap(([f, arr]) => arr.map(b => ({ ...b, file: f })));
  const trace = state.trace || [];
  host.innerHTML = `<div class="insp-toolbar">
      <button class="mini-btn" id="dbgRefresh">↻ Трассировка</button>
      <button class="mini-btn" id="dbgStepInto">↓ Step into</button>
      <button class="mini-btn" id="dbgStepOver">→ Step over</button>
      <button class="mini-btn" id="dbgStepOut">↑ Step out</button>
      <button class="mini-btn" id="dbgResume">▶ Resume</button>
      <button class="mini-btn" id="dbgAddBp">＋ Точка</button></div>
    <div class="section"><h3>Точки останова <span class="count">${bps.length}</span></h3>
      <div class="debug-steps">${bps.length ? bps.map(b => `<div class="kv"><span>${esc(b.file)}:${b.line}</span>
        <span>${b.condition ? ' ' + esc(b.condition) : 'обычная'}</span>
        <button class="mini-btn" data-bpdel="${esc(b.file)}:${b.line}"></button></div>`).join('') : '<div class="empty-note">Клик «＋ Точка» и укажите строку</div>'}</div></div>
    <div class="section"><h3>Выполненные строки <span class="count">${trace.length}</span></h3>
      <div class="debug-steps" id="timeline" style="max-height:150px;overflow:auto">${trace.slice(-120).map((t, i) => `<div class="timeline-row ${i === state.traceIndex ? 'active' : ''}" data-ti="${i}">
        <span>${t.t}ms</span><b>${esc(t.file)}:${t.line}</b><span>${esc(Object.keys(t.vars || {}).slice(0, 5).join(', '))}</span></div>`).join('') || '<div class="empty-note">Запустите код — трассировщик запишет executed lines</div>'}</div></div>
    <div class="section"><h3>Scope / Watch</h3>
      <div class="debug-steps" id="scopeBox">${scopeHtml()}</div>
      <div class="rowflex" style="padding:0 10px 10px"><input id="watchInput" placeholder="watch: выражение" style="flex:1;height:26px;border-radius:8px;border:1px solid var(--border);background:var(--code-bg);padding:0 8px;font-size:11px"><button class="mini-btn" id="watchAdd">＋</button></div></div>
    <div class="section"><h3>Call stack</h3><div class="stack-list">${stackHtml()}</div></div>`;
  host.querySelector('#dbgRefresh').onclick = () => { send('getTrace', {}); toast('Запрошена трассировка', 'info'); };
  host.querySelector('#dbgStepInto').onclick = () => step(1);
  host.querySelector('#dbgStepOver').onclick = () => { const d = (state.trace[state.traceIndex] || {}).depth || 0; let i = state.traceIndex + 1; while (i < state.trace.length && (state.trace[i].depth || 0) > d) i++; state.traceIndex = Math.min(i, state.trace.length - 1); renderDebug(); };
  host.querySelector('#dbgStepOut').onclick = () => { const d = (state.trace[state.traceIndex] || {}).depth || 0; let i = state.traceIndex + 1; while (i < state.trace.length && (state.trace[i].depth || 0) >= d) i++; state.traceIndex = Math.min(i, state.trace.length - 1); renderDebug(); };
  host.querySelector('#dbgResume').onclick = () => { state.traceIndex = state.trace.length - 1; renderDebug(); toast('Продолжено до конца трассировки', 'info'); };
  host.querySelector('#dbgAddBp').onclick = addBreakpointDialog;
  host.querySelectorAll('[data-bpdel]').forEach(b => b.onclick = () => { const [f, l] = b.dataset.bpdel.split(':'); setBreakpoint(f, +l); });
  host.querySelectorAll('[data-ti]').forEach(n => n.onclick = () => { state.traceIndex = +n.dataset.ti; renderDebug(); });
  host.querySelector('#watchAdd').onclick = async () => {
    const input = host.querySelector('#watchInput'), expr = input.value.trim(); if (!expr) return;
    state.watch.push(expr);
    const res = await evalInPreview(expr);
    state.watchValues = state.watchValues || {};
    state.watchValues[expr] = res?.error || res?.value?.p || '—';
    input.value = ''; renderDebug();
  };
}
function step(n) { state.traceIndex = Math.max(0, Math.min(state.trace.length - 1, state.traceIndex + n)); renderDebug(); }
function scopeHtml() {
  const t = state.trace[state.traceIndex];
  const vars = t?.vars || {};
  const entries = Object.entries(vars);
  const watches = state.watch || [];
  return (entries.length ? entries.slice(0, 16).map(([k, v]) => `<div class="kv"><span>${esc(k)}</span><b>${esc(typeof v === 'object' ? JSON.stringify(v) : String(v))}</b></div>`).join('') : '<div class="dim" style="padding:4px">Переменные появятся при шаге по трассировке</div>') +
    watches.map(w => `<div class="kv"><span> ${esc(w)}</span><b>${esc((state.watchValues || {})[w] || '—')}</b></div>`).join('');
}
function stackHtml() {
  const t = state.trace[state.traceIndex];
  if (!t) return '<div class="dim">Стек пуст</div>';
  return `<div class="kv"><span>текущая</span><b>${esc(t.file)}:${t.line}</b></div>
    <div class="kv"><span>время</span><b>${t.t} ms</b></div>
    <div class="kv"><span>глубина</span><b>${t.depth || 1}</b></div>
    <div class="kv"><span>всего шагов</span><b>${state.trace.length}</b></div>`;
}
export function addBreakpointDialog() {
  const cur = state.panes[state.activePane] || 'script.js';
  ctx.modal({ title: 'Точка останова', narrow: true,
    body: `<div class="field-row"><div class="field"><label>Файл</label><input id="bpFile" value="${esc(cur)}"></div>
      <div class="field"><label>Строка</label><input id="bpLine" type="number" value="1"></div></div>
      <div class="field"><label>Условие (необязательно)</label><input id="bpCond" placeholder="count > 3"></div>
      <p class="muted" style="font-size:11px">Трассировщик отметит совпадение в отладчике. Условные выражения выполняются в контексте предпросмотра.</p>`,
    okText: 'Добавить',
    onOk: root => {
      const f = root.querySelector('#bpFile').value.trim(), l = +root.querySelector('#bpLine').value || 1;
      const c = root.querySelector('#bpCond').value.trim();
      const existing = (state.breakpoints[f] || []).find(b => b.line === l);
      if (existing) { existing.condition = c; toast('Условие обновлено', 'ok'); }
      else { state.breakpoints[f] = [...(state.breakpoints[f] || []), { line: l, condition: c, enabled: true }]; }
      emit('breakpoints', state.breakpoints);
      toast(`Точка останова: ${f}:${l}`, 'ok');
    } });
}

/* ══════════════════ DOM / network / storage / perf / log ══════════════════ */
export function renderDom() {
  const host = $('#domPanel'); if (!host) return;
  const selected = state.selectedElement;
  host.innerHTML = `<div class="insp-toolbar"><button class="mini-btn" id="domRefresh">↻ Обновить DOM</button>
      <button class="mini-btn" id="domInspect">⌖ Инспектор</button><button class="mini-btn" id="domA11y"> a11y</button>
      <button class="mini-btn" id="domSpeech"> Скринридер</button></div>
    <div class="dom-tree" id="domTreeBox">${state.domTree ? domHtml(state.domTree, 0) : '<div class="empty-note">Нажмите «Обновить DOM»</div>'}</div>
    <div class="section"><h3>Computed styles ${selected ? '— ' + esc(selected.tag) : ''}</h3>
      <div class="debug-steps">${Object.entries(state.computedStyles || {}).map(([k, v]) => `<div class="kv"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('') || '<div class="dim">Выберите элемент в предпросмотре</div>'}</div></div>
    <div class="section"><h3>Event listeners <span class="count">${(state.listeners || []).length}</span></h3>
      <div class="debug-steps">${(state.listeners || []).slice(-20).map(l => `<div class="kv"><span>${esc(l.target)}</span><b>${esc(l.type)}</b></div>`).join('') || '<div class="dim">Нет данных</div>'}</div></div>`;
  host.querySelector('#domRefresh').onclick = () => refreshInspectors();
  host.querySelector('#domInspect').onclick = () => ctx.runCommand('inspectMode');
  host.querySelector('#domA11y').onclick = () => emulateA11y();
  host.querySelector('#domSpeech').onclick = () => screenReader();
  host.querySelectorAll('.dom-node').forEach(n => n.onclick = () => send('highlight', { selector: n.dataset.sel }));
}
function domHtml(node, depth) {
  if (!node || depth > 6) return '';
  const attrs = Object.entries(node.attrs || {}).slice(0, 5).map(([k, v]) => ` <span class="dom-attr">${esc(k)}</span>=<span class="dom-id">"${esc(v.slice(0, 24))}"</span>`).join('');
  const sel = node.attrs?.id ? '#' + node.attrs.id : node.tag;
  return `<div class="dom-node" data-sel="${esc(sel)}" style="padding-left:${depth * 12}px">
    <span class="dim">${'│ '.repeat(depth)}</span><span class="dom-tag">&lt;${esc(node.tag)}</span>${attrs}<span class="dom-tag">&gt;</span>
    ${node.text ? `<span class="dim"> ${esc(node.text.slice(0, 40))}</span>` : ''}</div>` +
    (node.kids || []).map(k => domHtml(k, depth + 1)).join('');
}
export function renderNetwork() {
  const host = $('#networkPanel'); if (!host) return;
  const items = state.network || [];
  const rows = items.slice(-60).map(n => {
    const color = (n.status >= 400 || n.status < 0) ? 'var(--err)' : 'var(--ok)';
    return '<div class="kv"><span style="max-width:55%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(n.url) + '">' +
      esc(n.method || 'GET') + ' ' + esc(n.url) + '</span><b style="color:' + color + '">' + (n.status || '—') +
      '</b><span>' + (n.ms || 0) + 'ms' + (n.local ? ' · VFS' : '') + '</span></div>';
  }).join('');
  const empty = '<div class="empty-note">Запросов пока нет. Вызовите fetch() — запрос появится здесь.</div>';
  host.innerHTML = '<div class="insp-toolbar"><button class="mini-btn" id="netRefresh">↻</button>' +
    '<span class="muted">' + items.length + ' запросов</span><button class="mini-btn" id="netClear">Очистить</button></div>' +
    '<div class="debug-steps">' + (rows || empty) + '</div>';
  host.querySelector('#netRefresh').onclick = () => send('getNetwork', {});
  host.querySelector('#netClear').onclick = () => { state.network = []; renderNetwork(); };
}
export function renderStorage() {
  const host = $('#storagePanel'); if (!host) return;
  const d = state.storageData || {};
  const block = (title, obj) => `<div class="section"><h3>${title}</h3><div class="debug-steps">${Object.entries(obj || {}).map(([k, v]) => `<div class="kv"><span>${esc(k)}</span><b>${esc(String(v).slice(0, 60))}</b></div>`).join('') || '<div class="dim">пусто</div>'}</div></div>`;
  host.innerHTML = `<div class="insp-toolbar"><button class="mini-btn" id="stRefresh">↻ Обновить</button><span class="muted">изолировано в sandbox</span></div>` +
    block('localStorage', d.local) + block('sessionStorage', d.session) +
    `<div class="section"><h3>Cookies</h3><div class="debug-steps"><div class="kv"><span>document.cookie</span><b>${esc(d.cookies || '—')}</b></div></div></div>`;
  host.querySelector('#stRefresh').onclick = () => send('getStorage', {});
}
export function renderPerf() {
  const host = $('#perfPanel'); if (!host) return;
  const p = state.perf || {}, r = state.report;
  const size = Object.values(state.files).reduce((n, f) => n + (f.content?.length || 0), 0);
  const lighthouse = r?.score ?? Math.max(0, 100 - Math.round(size / 2000));
  host.innerHTML = `<div class="insp-toolbar"><button class="mini-btn" id="perfRefresh">↻ Замеры</button>
    <button class="mini-btn" id="perfTips">Советы</button><span class="spacer"></span>
    <span class="muted">Lighthouse-подобная оценка: <b style="color:${lighthouse > 75 ? 'var(--ok)' : 'var(--warn)'}">${lighthouse}</b></span></div>
    <div class="grade-bars" style="padding-top:12px">
      ${metric('LCP', (p.lcp || p.renderMs || 0) + ' ms')}${metric('CLS', p.cls ?? 0)}${metric('FID', (p.fid || 0) + ' ms')}
      ${metric('Рендер', (p.renderMs || p.load || 0) + ' ms')}${metric('Бандл', fmtBytes(size))}${metric('Элементов', p.elements || 0)}</div>
    <div class="section"><h3>Ресурсы</h3><div class="debug-steps">${(p.resources || []).slice(0, 20).map(x => `<div class="kv"><span style="max-width:70%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(x.name.slice(0, 70))}</span><b>${x.duration}ms</b></div>`).join('') || '<div class="dim">Внешних ресурсов нет</div>'}</div></div>
    <div class="section"><h3>Long tasks</h3><div class="debug-steps"><div class="kv"><span>Задач > 50 мс</span><b>${p.longTasks || 0}</b></div></div></div>`;
  host.querySelector('#perfRefresh').onclick = () => send('getPerf', {});
  host.querySelector('#perfTips').onclick = () => ctx.modal({ title: 'Советы по производительности',
    body: '<ul style="font-size:12px;line-height:1.8">' + perfTips().map(t => `<li>${esc(t)}</li>`).join('') + '</ul>', okText: 'Понятно' });
}
export function renderLog() {
  const host = $('#logPanel'); if (!host) return;
  host.innerHTML = `<div class="insp-toolbar"><button class="mini-btn" id="logExport"> Журнал</button>
    <button class="mini-btn" id="logClear2">Очистить</button><span class="spacer"></span><span class="muted">${state.activity.length} событий</span></div>
    <div class="debug-steps">${state.activity.map(a => `<div class="kv"><span>${new Date(a.t).toLocaleTimeString('ru-RU')}</span><b style="font-weight:400;text-align:right">${esc(a.msg.slice(0, 90))}</b></div>`).join('') || '<div class="empty-note">Журнал пуст</div>'}</div>`;
  host.querySelector('#logExport').onclick = () => download('runlet-activity.json', JSON.stringify(state.activity, null, 2), 'application/json');
  host.querySelector('#logClear2').onclick = () => { state.activity = []; renderLog(); };
}
function showA11yScan(data) {
  ctx.modal({ title: ' Отчёт о доступности', wide: false,
    body: `<p><b>Фокусируемых элементов:</b> ${data.focusables}</p><p><b>Заголовков:</b> ${data.headings}</p>
      <p><b>Язык страницы:</b> ${esc(data.lang || 'не указан')}</p>
      <h4 style="margin:12px 0 6px">Проблемы (${data.issues.length})</h4>
      <ul style="font-size:12px;line-height:1.7">${data.issues.length ? data.issues.map(i => `<li>${esc(i)}</li>`).join('') : '<li>Проблем не найдено </li>'}</ul>`,
    okText: 'Закрыть' });
}

/* a11y helpers exposed as commands */
export function contrastTool() {
  ctx.modal({ title: 'Проверка контраста WCAG', narrow: true,
    body: `<div class="field-row"><div class="field"><label>Текст</label><input type="color" id="cText" value="#ffffff"></div>
      <div class="field"><label>Фон</label><input type="color" id="cBg" value="#10132a"></div></div>
      <div id="contrastRes" class="gen-preview" style="color:#fff;background:#10132a">Пример текста</div>`,
    okText: 'Закрыть',
    onMount: root => {
      const upd = () => {
        const a = root.querySelector('#cText').value, b = root.querySelector('#cBg').value;
        const ratio = contrast(a, b);
        const box = root.querySelector('#contrastRes');
        box.style.color = a; box.style.background = b;
        box.textContent = `${ratio.toFixed(2)}:1 — ${contrastVerdict(ratio)}`;
      };
      root.querySelectorAll('input').forEach(i => i.addEventListener('input', upd)); upd();
    } });
}
