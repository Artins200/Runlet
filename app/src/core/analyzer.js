/* Analysis client: talks to the Python engine (Electron IPC or /api/analyze),
   falls back to an in-browser JS analyser, applies quick fixes. */
import { state, ctx, emit, on, toast, busy, debounce, esc } from './core.js';
import { allTextFiles, read, write, exists } from './state.js';
import { CSS_PROPS, CSS_VALUES } from './data.js';
import { editors, setDoc, getDoc, goto } from './editor.js';
import * as acorn from 'acorn';

export function analysisJob() {
  return {
    files: allTextFiles(), entry: state.entry,
    deps: state.deps.map(d => (typeof d === 'string' ? d : d.id)),
    locale: state.settings.locale, active: state.activePane
  };
}

let pending = 0;
export async function runAnalysis({ silent = false, force = false } = {}) {
  const job = analysisJob();
  if (!Object.keys(job.files).length) return null;
  if (!silent) busy(true);
  const seq = ++pending;
  let report = null;
  try {
    if (window.runlet?.analyze) {
      report = await window.runlet.analyze(job);       // Electron → python3 engine.py --server
    } else {
      const res = await fetch('/api/analyze', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(job)
      });
      if (res.ok) report = await res.json();
    }
  } catch (e) {
    console.warn('[runlet] python engine unavailable:', e.message);
  }
  if (!report || !report.ok) report = fallbackAnalyze(job);
  if (seq !== pending) return report; // a newer run won
  state.report = report;
  state.engine = report.engine || 'js';
  const badge = document.querySelector('#engineBadge');
  if (badge) {
    badge.textContent = report.engine?.startsWith('runlet-python') ? 'Python-движок' : 'JS-анализ';
    badge.style.opacity = report.engine?.startsWith('runlet-python') ? '1' : '.75';
  }
  const st = document.querySelector('#statusEngine');
  if (st) st.textContent = (report.engine?.startsWith('runlet-python') ? '◉ Python-движок' : '◉ JS-анализ') +
    ` · ${report.elapsed_ms ?? 0} мс`;
  const badgeN = document.querySelector('#analyzeBadge');
  if (badgeN) badgeN.textContent = (report.metrics?.diagnostics?.error || 0) + '';
  const sc = document.querySelector('#statusScore');
  if (sc) sc.textContent = `Анализ: ${report.score}/100`;
  const cnt = document.querySelector('#analysisCount');
  if (cnt) cnt.textContent = report.diagnostics?.length || 0;
  emit('analysis:report', report);
  if (!silent) toast(`Анализ готов: ${report.score}/100 · ${(report.metrics?.diagnostics?.error || 0)} ошибок`, 'ok', 'Анализ кода');
  busy(false);
  return report;
}

export const scheduleAnalysis = debounce(() => {
  if (state.settings.autoAnalyze) runAnalysis({ silent: true });
}, 1600);

/* ── quick fixes ──────────────────────────────────────────────────── */
export function paneForFile(file) {
  for (const [p, f] of Object.entries(state.panes)) if (f === file) return p;
  return null;
}
export function applyFix(d) {
  const edit = d.edit;
  if (!edit) { toast('Для этого замечания автоисправление не заготовлено', 'info'); return false; }
  const pane = paneForFile(d.file);
  let code = pane ? getDoc(pane) : (exists(d.file) ? read(d.file) : '');
  if (!code && !edit.kind) return false;
  let out = code, changed = false;
  if (edit.kind === 'prepend') { out = edit.text + code; changed = true; }
  else if (edit.kind === 'insert-after-line') {
    const lines = code.split('\n');
    const i = Math.max(0, Math.min(lines.length, (edit.line || 1)));
    lines.splice(i, 0, edit.text); out = lines.join('\n'); changed = true;
  } else if (edit.kind === 'replace' && edit.find) {
    const i = code.indexOf(edit.find);
    if (i >= 0) { out = code.slice(0, i) + edit.replace + code.slice(i + edit.find.length); changed = true; }
  } else if (edit.kind === 'regex') {
    try {
      const re = new RegExp(edit.pattern, edit.flags || 'g');
      if (re.test(code)) { out = code.replace(re, edit.replacement); changed = true; }
    } catch (e) { }
  } else if (edit.kind === 'trim') {
    out = code.replace(/[ \t]+$/gm, ''); changed = true;
  } else if (edit.kind === 'convert') {
    out = code.split(edit.from || '==').join(edit.to || '==='); changed = true;
  }
  if (!changed) { toast('Не нашёл, что исправить — возможно, код уже изменён', 'warn'); return false; }
  if (pane) setDoc(out, pane); else write(d.file, out);
  toast('Исправление применено: ' + d.id, 'ok', 'Автопочинка');
  setTimeout(() => runAnalysis({ silent: true }), 250);
  return true;
}
export function fixAllSafe(limit = 12) {
  const report = state.report; if (!report) return 0;
  const safe = report.diagnostics.filter(d => d.edit && d.sev !== 'error');
  let n = 0;
  for (const d of safe.slice(0, limit)) if (applyFix(d)) n++;
  toast(`Применено исправлений: ${n}`, 'ok', 'Автопочинка');
  return n;
}
export function gotoDiagnostic(d) {
  const pane = paneForFile(d.file) || ({ html: 'html', css: 'css', js: 'js' })[(d.file || '').split('.').pop()] || state.activePane;
  if (d.file && !state.panes[pane]) return;
  goto(pane, d.line, d.col || 1, d.file);
}
export function reportMarkdown() {
  const r = state.report;
  return r?.markdown || 'Отчёт пока не создан — нажмите «Анализ кода».';
}
export function reportJSON() { return JSON.stringify(state.report, null, 2); }

/* ══════════════════ JS fallback analyser ══════════════════ */
export function fallbackAnalyze(job) {
  const t0 = performance.now();
  const files = job.files || {};
  const diags = [];
  let seq = 0;
  const add = (id, sev, file, line, msg, cat = 'correctness', fix = '', why = '', edit = null) =>
    diags.push({ id, sev, file, line, col: 1, msg, why, fix, cat, edit, src: 'js' });
  const htmlCode = files[job.entry] || Object.entries(files).find(([k]) => /\.html?$/i.test(k))?.[1] || '';
  const htmlFile = job.entry in files ? job.entry : Object.keys(files).find(k => /\.html?$/i.test(k)) || 'index.html';
  const title = (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(htmlCode) || [])[1]?.trim() || '';
  const h1 = (/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(htmlCode) || [])[1]?.replace(/<[^>]+>/g, '').trim() || '';
  const ids = {}, classes = new Set(), tags = new Set();
  const voids = new Set('area base br col embed hr img input link meta param source track wbr'.split(' '));
  const lineAt = (code, idx) => code.slice(0, idx).split('\n').length;

  // HTML structure
  if (htmlCode && !/^\s*<!doctype/i.test(htmlCode)) add('HTML001', 'warning', htmlFile, 1, 'Нет <!DOCTYPE html>.', 'correctness', 'Добавьте <!DOCTYPE html>', '', { kind: 'prepend', text: '<!DOCTYPE html>\n' });
  if (htmlCode && !/<html[^>]+lang=/i.test(htmlCode)) add('HTML002', 'warning', htmlFile, lineAt(htmlCode, htmlCode.indexOf('<html')), 'У <html> нет lang.', 'a11y', 'lang="ru"');
  if (!/<title/i.test(htmlCode)) add('HTML005', 'warning', htmlFile, 1, 'Нет <title>.', 'seo', 'Добавьте <title>');
  if (!/name=["']viewport/i.test(htmlCode)) add('HTML004', 'warning', htmlFile, 1, 'Нет meta viewport.', 'seo', 'Добавьте meta viewport');
  const stack = [];
  const tagRe = /<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>/g;
  let m;
  while ((m = tagRe.exec(htmlCode))) {
    const [, close, tag, attrs, self] = m;
    const L = lineAt(htmlCode, m.index);
    tags.add(tag.toLowerCase());
    if (close) {
      const idx = stack.map(x => x.t).lastIndexOf(tag.toLowerCase());
      if (idx < 0) add('HTML010', 'warning', htmlFile, L, `Лишний </${tag}>.`);
      else if (idx !== stack.length - 1) add('HTML011', 'error', htmlFile, L, `Нарушена вложенность: </${tag}> закрывает родителя.`);
      stack.length = Math.max(0, idx);
    } else if (!voids.has(tag.toLowerCase()) && !self) {
      stack.push({ t: tag.toLowerCase(), line: L });
      const idm = /\bid=["']([^"']+)/.exec(attrs);
      if (idm) {
        if (ids[idm[1]]) add('HTML020', 'error', htmlFile, L, `Дублирующийся id="${idm[1]}".`, 'a11y');
        ids[idm[1]] = L;
      }
      const cm = /\bclass=["']([^"']+)/.exec(attrs);
      if (cm) cm[1].split(/\s+/).forEach(c => classes.add(c));
      if (tag.toLowerCase() === 'img' && !/\balt=/.test(attrs)) add('HTML021', 'warning', htmlFile, L, 'У <img> нет alt.', 'a11y', 'Добавьте alt');
      if (/\bon\w+=/.test(attrs)) add('HTML032', 'warning', htmlFile, L, 'Встроенный on*-обработчик.', 'security', 'addEventListener');
      if (/^(font|center|marquee|big|strike|blink)$/i.test(tag)) add('HTML040', 'warning', htmlFile, L, `Устаревший тег <${tag}>.`);
    }
  }
  for (const s of stack.slice(0, 5)) add('HTML013', 'error', htmlFile, s.line, `Незакрытый тег <${s.t}>.`, 'correctness', `</${s.t}>`);

  // CSS
  let cssRules = 0, colors = [], selectors = [];
  for (const [file, code] of Object.entries(files)) {
    if (!/\.(css|scss|less)$/i.test(file)) continue;
    const open = (code.match(/\{/g) || []).length, close = (code.match(/\}/g) || []).length;
    if (open > close) add('CSS001', 'error', file, code.split('\n').length, `Не хватает ${open - close} закрывающей скобки }.`);
    const rules = [...code.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
    cssRules += rules.length;
    for (const r of rules) {
      const sel = r[1].trim().split('\n').pop().trim();
      const line = lineAt(code, r.index);
      if (sel && !sel.startsWith('@')) selectors.push(sel);
      for (const d of r[2].split(';')) {
        const [prop, ...rest] = d.split(':');
        const p = (prop || '').trim().toLowerCase(), v = rest.join(':').trim();
        if (!p || p.startsWith('--')) continue;
        if (!CSS_PROPS.includes(p) && !p.startsWith('-')) add('CSS020', 'warning', file, line, `Неизвестное свойство "${p}".`);
        if (/!important/.test(v)) add('CSS030', 'info', file, line, `!important у "${p}".`, 'style');
        if (/(^|\s)(margin|padding|width|height|font-size|border-radius|gap)\b/.test(p) && /^\d+(\.\d+)?$/.test(v))
          add('CSS021', 'warning', file, line, `"${p}: ${v}" — число без единиц.`, 'correctness', 'Добавьте px');
        const col = /#[0-9a-f]{3,8}\b/i.exec(v);
        if (col) colors.push(col[0]);
      }
    }
  }

  // JS
  const behavior = { events: [], network: [], timers: [], storage: [], dom_writes: [], selectors: [], imports: [], colors, animations: [], layout: {} };
  for (const [file, code] of Object.entries(files)) {
    if (!/\.(js|mjs|ts|jsx|tsx)$/i.test(file)) continue;
    try {
      acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'module', locations: true, allowAwaitOutsideFunction: true, allowReturnOutsideFunction: true });
    } catch (e) {
      add('JS100', 'error', file, e.loc?.line || 1, 'Синтаксическая ошибка: ' + e.message.replace(/ \(\d+:\d+\)$/, ''), 'correctness', 'Проверьте скобки и кавычки');
    }
    code.split('\n').forEach((line, i) => {
      const L = i + 1;
      if (/[^=!]==[^=]/.test(line) && !/==\s*null/.test(line)) add('JS021', 'hint', file, L, 'Нестрогое == — лучше ===.', 'style', '===');
      if (/\bvar\s+\w/.test(line)) add('JS023', 'hint', file, L, 'var лучше заменить на let/const.', 'style');
      if (/\beval\s*\(|new Function/.test(line)) add('JS030', 'warning', file, L, 'eval() — риск XSS.', 'security');
      if (/\.innerHTML\s*=/.test(line)) add('JS032', 'warning', file, L, 'innerHTML — риск XSS.', 'security', 'textContent');
      if (/console\.log/.test(line)) add('JS050', 'hint', file, L, 'Отладочный console.log.', 'style');
      if (/JSON\.parse/.test(line) && !/try/.test(code)) add('JS039', 'warning', file, L, 'JSON.parse без try/catch.', 'correctness');
      if (/\bfetch\s*\(/.test(line) && !/\.catch|try\b/.test(code)) add('JS040', 'warning', file, L, 'fetch без обработки ошибки.', 'correctness');
      const q = /(?:querySelector(?:All)?|getElementById)\s*\(\s*['"]([^'"]+)['"]/.exec(line);
      if (q) {
        const sel = q[1];
        const found = sel.startsWith('#') ? !!ids[sel.slice(1)] : sel.startsWith('.') ? classes.has(sel.slice(1)) : tags.has(sel.toLowerCase());
        behavior.selectors.push({ selector: sel, line: L, file, exists: found });
        if (!found) add('JS060', 'error', file, L, `Селектор "${sel}" не найден в HTML — будет TypeError при обращении к null.`, 'correctness', 'Проверьте элемент');
      }
      const ev = /\.addEventListener\s*\(\s*['"](\w+)/.exec(line);
      if (ev) behavior.events.push({ type: ev[1], target: (line.match(/(\w+)\.addEventListener/) || [])[1] || 'element', line: L, file });
      const f = /\bfetch\s*\(\s*['"]([^'"]+)/.exec(line);
      if (f) behavior.network.push({ url: f[1], line: L, file, method: 'fetch' });
      if (/set(Timeout|Interval)\s*\(/.test(line)) behavior.timers.push({ kind: RegExp.$1, line: L, file });
      const ls = /(localStorage|sessionStorage)\.setItem\s*\(\s*['"]([^'"]+)/.exec(line);
      if (ls) behavior.storage.push({ store: ls[1], key: ls[2], line: L, file });
      if (/textContent|innerHTML|classList|appendChild/.test(line)) behavior.dom_writes.push({ kind: 'DOM', line: L, file });
    });
  }

  // broken local links
  const links = [];
  for (const [file, code] of Object.entries(files)) {
    for (const mm of code.matchAll(/(?:src|href)\s*=\s*["']([^"'#]+)["']/g)) {
      const ref = mm[1];
      if (/^(https?:|data:|mailto:|\/\/)/.test(ref)) continue;
      const target = ref.replace(/^\.?\//, '');
      const ok = Object.keys(files).some(k => k === target || k.endsWith('/' + target));
      links.push({ from: file, line: lineAt(code, mm.index), to: target, ok, external: false });
      if (!ok) add('LNK001', 'error', file, lineAt(code, mm.index), `Битая ссылка: "${ref}" не найден.`, 'correctness', 'Загрузите файл');
    }
  }

  const errors = diags.filter(d => d.sev === 'error').length;
  const warnings = diags.filter(d => d.sev === 'warning').length;
  const score = Math.max(0, Math.min(100, 100 - errors * 9 - warnings * 3 - diags.filter(d => d.sev === 'info').length - diags.filter(d => d.sev === 'hint').length * .4));
  const grades = {
    correctness: Math.max(0, 100 - errors * 12), a11y: Math.max(0, 100 - diags.filter(d => d.cat === 'a11y').length * 12),
    seo: Math.max(0, 100 - diags.filter(d => d.cat === 'seo').length * 15),
    perf: Math.max(0, 100 - diags.filter(d => d.cat === 'perf').length * 8),
    security: Math.max(0, 100 - diags.filter(d => d.cat === 'security').length * 15),
    style: Math.max(0, 100 - diags.filter(d => d.sev === 'hint').length * 5)
  };
  const steps = [
    { icon: 'load', text: `Браузер загрузит ${htmlFile || 'index.html'} и применит ${cssRules} CSS-правил.`, confidence: 'точно' },
    ...(behavior.events.length ? [{ icon: 'click', text: `Будут повешены обработчики: ${[...new Set(behavior.events.map(e => e.type + ' на ' + e.target))].slice(0, 4).join(', ')}.`, confidence: 'скорее всего' }] : []),
    ...(behavior.network.length ? [{ icon: 'net', text: `Будут сетевые запросы: ${behavior.network.map(n => n.url).slice(0, 3).join(', ')}.`, confidence: 'скорее всего' }] : []),
    ...(errors ? [{ icon: 'error', text: `Найдено ошибок: ${errors}. Первая — ${diags.find(d => d.sev === 'error')?.msg}`, confidence: 'почти наверняка' }] :
      [{ icon: 'ok', text: 'Явных ошибок не найдено — код, скорее всего, запустится.', confidence: 'возможно' }])
  ];
  const summary = {
    headline: `«${title || h1 || 'Без названия'}» — ${behavior.events.length || behavior.dom_writes.length ? 'интерактивная страница' : 'статичная страница'}`,
    description: `В разметке ${(htmlCode.match(/<[a-zA-Z]/g) || []).length} тегов, ${Object.keys(ids).length} уникальных id. CSS-правил: ${cssRules}. Цветов: ${colors.length}.`,
    steps,
    beginner: ['HTML — это кирпичи страницы, CSS — внешний вид, JavaScript — поведение.', 'Если элемент не найден, querySelector возвращает null и обращение к нему вызовет ошибку.'],
    verdict: errors ? 'Код, скорее всего, упадёт при запуске' : warnings ? 'Код работает, но есть замечания' : 'Код выглядит рабочим',
    verdict_level: errors ? 'error' : warnings ? 'warn' : 'ok'
  };
  return {
    ok: true, engine: 'runlet-js/1.0', elapsed_ms: Math.round(performance.now() - t0),
    score: Math.round(score), grades, summary, behavior,
    diagnostics: diags.sort((a, b) => ({ error: 0, warning: 1, info: 2, hint: 3 }[a.sev] - { error: 0, warning: 1, info: 2, hint: 3 }[b.sev])),
    metrics: {
      files: Object.keys(files).length, lines: Object.values(files).reduce((n, c) => n + c.split('\n').length, 0),
      bytes: Object.values(files).reduce((n, c) => n + c.length, 0),
      html: { tags: tags.size, ids: Object.keys(ids).length }, css: { rules: cssRules, colors: colors.length },
      js: { events: behavior.events.length, network: behavior.network.length, functions: 0 },
      diagnostics: { error: errors, warning: warnings, info: diags.filter(d => d.sev === 'info').length, hint: diags.filter(d => d.sev === 'hint').length },
      broken_links: links.filter(l => !l.ok).length
    },
    functions: [], links, colors: colors.map(c => ({ value: c })), selectors: [],
    glossary: [{ term: 'querySelector', meaning: 'ищет элемент; если не нашёл — null.' }],
    markdown: buildMarkdown(summary, diags, Math.round(score))
  };
}
function buildMarkdown(summary, diags, score) {
  return `# Отчёт Runlet (JS-движок)\n\n**Оценка:** ${score}/100 · ${summary.verdict}\n\n## ${summary.headline}\n\n${summary.description}\n\n` +
    `## Что произойдёт\n${summary.steps.map(s => '- ' + s.text).join('\n')}\n\n## Замечания\n` +
    (diags.length ? diags.map(d => `- **${d.sev}** \`${d.file}:${d.line}\` — ${d.msg}`).join('\n') : 'Нет.');
}
