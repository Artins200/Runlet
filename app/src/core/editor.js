/* CodeMirror 6 editors: 3 panes, completions, Emmet, snippets, lint, minimap, colors. */
import { EditorState, Compartment, StateEffect } from '@codemirror/state';
import {
  EditorView, keymap, lineNumbers, highlightActiveLineGutter, highlightSpecialChars,
  drawSelection, dropCursor, rectangularSelection, crosshairCursor, highlightActiveLine,
  hoverTooltip, Decoration, ViewPlugin, MatchDecorator,
  WidgetType, highlightWhitespace, highlightTrailingWhitespace
} from '@codemirror/view';
import {
  defaultKeymap, history, historyKeymap, indentWithTab, moveLineUp, moveLineDown,
  copyLineDown, toggleComment, deleteTrailingWhitespace, selectAll
} from '@codemirror/commands';
import { searchKeymap, openSearchPanel, selectNextOccurrence, selectSelectionMatches, highlightSelectionMatches } from '@codemirror/search';
import {
  foldGutter, foldKeymap, bracketMatching, indentOnInput, syntaxHighlighting,
  HighlightStyle, foldAll, unfoldAll, foldService
} from '@codemirror/language';
import {
  autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap,
  completeFromList, snippet, snippetCompletion, startCompletion
} from '@codemirror/autocomplete';
import { lintKeymap, linter, lintGutter, forceLinting } from '@codemirror/lint';
import { html, autoCloseTags, htmlCompletionSource } from '@codemirror/lang-html';
import { css, cssCompletionSource } from '@codemirror/lang-css';
import { javascript, localCompletionSource } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { tags as T } from '@lezer/highlight';
import * as acorn from 'acorn';
import beautify from 'js-beautify';
import { state, ctx, $, $$, emit, on, toast, debounce, esc } from './core.js';
import { icon } from './icons.js';
import { read, write, exists, isText, paneOf } from './state.js';
import { HTML_TAGS, HTML_ATTRS, CSS_PROPS, CSS_VALUES, CSS_FUNCTIONS, JS_COMPLETIONS,
         EMMET_CSS, DOCS, mdnLink, SNIPPETS } from './data.js';

export const editors = {};
const langComp = {};
const prefComp = {};
const readComp = {};
const internal = { html: false, css: false, js: false };
const PANES = ['html', 'css', 'js'];

const highlight = HighlightStyle.define([
  { tag: [T.keyword, T.modifier, T.controlKeyword, T.operatorKeyword], color: 'var(--kw)' },
  { tag: [T.string, T.special(T.string)], color: 'var(--str)' },
  { tag: [T.number, T.bool, T.null, T.atom], color: 'var(--num)' },
  { tag: [T.comment, T.lineComment, T.blockComment, T.meta], color: 'var(--com)', fontStyle: 'italic' },
  { tag: [T.function(T.variableName), T.function(T.propertyName)], color: 'var(--fn)' },
  { tag: [T.tagName, T.angleBracket], color: 'var(--tag)' },
  { tag: [T.attributeName], color: 'var(--attr)' },
  { tag: [T.propertyName, T.definition(T.propertyName)], color: 'var(--prop)' },
  { tag: [T.variableName, T.definition(T.variableName)], color: 'var(--text)' },
  { tag: [T.className, T.typeName, T.namespace], color: 'var(--fn)' },
  { tag: [T.punctuation, T.separator, T.bracket], color: 'var(--muted)' },
  { tag: [T.heading, T.strong], fontWeight: 'bold', color: 'var(--kw)' },
  { tag: [T.link, T.url], color: 'var(--info)', textDecoration: 'underline' },
  { tag: [T.invalid], color: 'var(--err)' }
]);

const cmTheme = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'transparent', color: 'var(--text)' },
  '.cm-scroller': { overflow: 'auto' },
  '.cm-content': { padding: '10px 0 60px', caretColor: 'var(--accent)' },
  '.cm-line': { padding: '0 10px' },
  '.cm-gutters': { borderRight: '1px solid var(--border)', minWidth: '38px' },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 6px 0 8px' },
  '.cm-foldGutter .cm-gutterElement': { color: 'var(--dim)' },
  '.cm-cursor': { borderLeft: '2px solid var(--accent)' },
  '.cm-activeLine': { background: 'color-mix(in srgb, var(--accent) 7%, transparent)' },
  '.cm-activeLineGutter': { background: 'color-mix(in srgb, var(--accent) 12%, transparent)' },
  '.cm-selectionBackground': { background: 'var(--sel) !important' },
  '.cm-tooltip': { borderRadius: '12px' },
  '.cm-tooltip-autocomplete': { fontFamily: 'var(--sans)' },
  '.cm-tooltip-autocomplete > ul > li': { padding: '4px 9px', fontSize: '12px' },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': { background: 'color-mix(in srgb,var(--accent) 35%,transparent)', color: '#fff' },
  '.cm-completionDetail': { color: 'var(--muted)', fontStyle: 'normal', fontSize: '10px' },
  '.cm-completionIcon': { opacity: .6 },
  '.cm-hover-tooltip': { maxWidth: '340px' },
  '.cm-lintRange': { backgroundImage: 'none' }
});

/* ── language for a pane/path ──────────────────────────────────────── */
export function languageFor(pane, path = '') {
  const e = (path.split('.').pop() || '').toLowerCase();
  if (['ts', 'tsx'].includes(e)) return javascript({ typescript: true, jsx: e === 'tsx' });
  if (['jsx'].includes(e)) return javascript({ jsx: true });
  if (['json', 'map'].includes(e)) return json();
  if (['md', 'markdown'].includes(e)) return markdown();
  if (['scss', 'less', 'sass'].includes(e)) return css();
  if (pane === 'html' || ['html', 'htm', 'vue', 'pug', 'svg'].includes(e)) return html({ autoCloseTags: true, matchClosingTags: true });
  if (pane === 'css' || ['css'].includes(e)) return css();
  return javascript();
}
export function langName(pane) {
  const e = (state.panes[pane] || '').split('.').pop().toLowerCase();
  return ({ html: 'HTML', htm: 'HTML', css: 'CSS', scss: 'SCSS', js: 'JavaScript',
            mjs: 'ESM', ts: 'TypeScript', jsx: 'JSX', json: 'JSON', md: 'Markdown' })[e] || pane.toUpperCase();
}

/* ── completion source ─────────────────────────────────────────────── */
function paneOfView(view) { return view.dom.dataset.pane || 'html'; }
function completionSource(context) {
  const pane = paneOfView(context.view);
  const before = context.matchBefore(/[\w#$@.\[\]-]*/);
  if (!before || (before.from === before.to && !context.explicit)) return null;
  const doc = context.state.doc.toString();
  const word = before.text;
  const inTag = /<[a-zA-Z][^>]*$/.test(context.state.sliceDoc(Math.max(0, before.from - 160), before.from));
  let options = [];
  if (pane === 'html') {
    if (inTag) {
      options = HTML_ATTRS.map(a => ({ label: a, type: 'property', detail: 'атрибут' }));
    } else {
      options = HTML_TAGS.map(t => ({
        label: t, type: 'type', detail: 'тег',
        apply: snippet('<' + t + '>${1}</' + t + '>')
      }));
    }
  } else if (pane === 'css') {
    const line = context.state.doc.lineAt(before.from).text.slice(0, before.to);
    const afterColon = /:\s*[^;]*$/.test(line);
    if (afterColon) {
      options = [...CSS_VALUES.map(v => ({ label: v, type: 'constant' })),
                 ...CSS_FUNCTIONS.map(f => ({ label: f, type: 'function', apply: snippet(f + '(${1})') }))];
    } else {
      options = CSS_PROPS.map(p => ({ label: p, type: 'property', apply: snippet(p + ': ${1};'), detail: 'CSS' }));
      for (const [k, v] of Object.entries(EMMET_CSS)) options.push({ label: k, type: 'keyword', apply: v.replace(/\$\{\d+:([^}]*)\}/g, '$1'), detail: 'Emmet: ' + v });
    }
  } else {
    options = JS_COMPLETIONS.map(k => ({
      label: k, type: /^[A-Z]/.test(k) ? 'class' : 'variable',
      info: DOCS[k]?.[0] || '', detail: DOCS[k] ? ' MDN' : 'глобал'
    }));
    for (const [k, v] of Object.entries(DOCS)) options.push({ label: k, type: 'property', info: v[0], detail: '' });
  }
  // snippets for this language
  for (const s of SNIPPETS.filter(x => x.cat === pane).slice(0, 40)) {
    options.push(snippetCompletion(escapeSnippet(s.code), {
      label: ' ' + s.name, detail: s.desc, type: 'text', boost: 2
    }));
  }
  for (const s of state.userSnippets.filter(x => x.cat === pane)) {
    options.push(snippetCompletion(escapeSnippet(s.code), { label: ' ' + s.name, detail: 'мой сниппет', type: 'text', boost: 3 }));
  }
  // words from current document
  const words = new Set((doc.match(/[A-Za-z_$][\w$]{2,}/g) || []).slice(-400));
  for (const w of words) if (!options.some(o => o.label === w)) options.push({ label: w, type: 'text', detail: 'слово' });
  return { from: before.from, options: options.slice(0, 220), validFor: /^[\w-]*$/ };
}
export function escapeSnippet(code) {
  // Keep numeric snippet fields, but protect literal `${...}` (JS template strings).
  return code.replace(/\$\{(?!\d+(?::[^}]*)?\})([^}]*)\}/g, '$\\{$1\\}');
}

/* ── hover documentation ───────────────────────────────────────────── */
const hover = hoverTooltip((view, pos) => {
  const { from, to, text } = view.state.doc.lineAt(pos);
  let start = pos - from, end = pos - from;
  while (start > 0 && /[\w$-]/.test(text[start - 1])) start--;
  while (end < text.length && /[\w$-]/.test(text[end])) end++;
  const word = text.slice(start, end);
  const info = DOCS[word];
  if (!info) return null;
  return {
    pos: from + start, end: from + end, above: true,
    create() {
      const box = document.createElement('div');
      box.style.cssText = 'padding:10px 12px;max-width:330px;font:12px var(--sans);line-height:1.5';
      box.innerHTML = '<b style="color:var(--accent)">' + esc(word) + '</b><div style="margin:5px 0;color:var(--muted)">' + esc(info[0]) + '</div>' +
        '<a href="' + mdnLink(word) + '" target="_blank" style="color:var(--info);font-size:11px"> Открыть MDN ' + icon('external', 12) + '</a>';
      return box;
    }
  };
}, { hoverTime: 350 });

/* ── color swatch widgets ──────────────────────────────────────────── */
class ColorWidget extends WidgetType {
  constructor(color, view) { super(); this.color = color; this.view = view; }
  eq(o) { return o.color === this.color; }
  toDOM() {
    const s = document.createElement('span');
    s.className = 'cm-color-chip'; s.style.background = this.color;
    s.title = 'Кликните, чтобы выбрать цвет';
    s.addEventListener('mousedown', e => {
      e.preventDefault(); e.stopPropagation();
      const pos = this.view.posAtDOM(s, 0);
      this.view.dom.dispatchEvent(new CustomEvent('runlet-color', {
        bubbles: true, detail: { color: this.color, pos }
      }));
    });
    return s;
  }
  ignoreEvent() { return true; }
}
const colorMatcher = new MatchDecorator({
  regexp: /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b/gi,
  decoration: (m, view, pos) => Decoration.widget({
    widget: new ColorWidget(m[0], view), side: -1
  })
});
const colorPlugin = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = colorMatcher.createDeco(view); }
  update(u) { if (u.docChanged || u.viewportChanged) this.decorations = colorMatcher.createDeco(u.view); }
}, { decorations: v => v.decorations });

/* ── region folding for //#region / <!-- region --> ─────────────────── */
const regionFold = foldService.of((state, lineStart, lineEnd) => {
  const line = state.doc.lineAt(lineStart);
  const start = /^\s*(?:\/\/|<!--|#)\s*#?region\b/.exec(line.text);
  if (!start) return null;
  const endRe = /^\s*(?:\/\/|<!--|#)\s*#?endregion\b/;
  for (let i = line.number + 1; i <= state.doc.lines; i++) {
    const l = state.doc.line(i);
    if (endRe.test(l.text)) return { from: line.to, to: l.from };
  }
  return null;
});

/* ── linting (syntax + Python report) ──────────────────────────────── */
function lintSource(view) {
  const pane = paneOfView(view);
  const code = view.state.doc.toString();
  const out = [];
  if (pane === 'js' && !/\.(json|md)$/.test(state.panes[pane] || '')) {
    try {
      acorn.parse(code, {
        ecmaVersion: 'latest', sourceType: 'module', locations: true,
        allowAwaitOutsideFunction: true, allowReturnOutsideFunction: true,
        allowHashBang: true
      });
    } catch (e) {
      const pos = Math.min(code.length, Math.max(0, e.pos || 0));
      out.push({ from: pos, to: Math.min(code.length, pos + 1), severity: 'error',
                 message: 'Синтаксическая ошибка: ' + e.message.replace(/ \(\d+:\d+\)$/, '') });
    }
  }
  const report = state.report;
  if (report && report.diagnostics) {
    const file = state.panes[pane];
    for (const d of report.diagnostics) {
      if (d.file !== file || d.sev === 'hint') continue;
      try {
        const line = view.state.doc.line(Math.min(d.line, view.state.doc.lines));
        const from = Math.min(line.to, line.from + Math.max(0, (d.col || 1) - 1));
        out.push({ from, to: Math.min(line.to, from + 1),
                   severity: d.sev === 'error' ? 'error' : d.sev === 'warning' ? 'warning' : 'info',
                   message: d.msg, source: 'runlet/' + d.id });
      } catch (e) { /* stale report */ }
    }
  }
  return out;
}

/* ── minimap ───────────────────────────────────────────────────────── */
const minimapTimers = {};
export function updateMinimap(pane) {
  const host = $(`[data-minimap="${pane}"]`);
  const view = editors[pane];
  if (!host || !view || !state.settings.minimap) return;
  clearTimeout(minimapTimers[pane]);
  minimapTimers[pane] = setTimeout(() => {
    let canvas = host.querySelector('canvas');
    if (!canvas) {
      canvas = document.createElement('canvas');
      host.appendChild(canvas);
      host.addEventListener('mousedown', e => {
        const rect = host.getBoundingClientRect();
        const ratio = (e.clientY - rect.top + host.scrollTop) / (canvas.height || 1);
        view.scrollDOM.scrollTop = ratio * Math.max(1, view.scrollDOM.scrollHeight - view.scrollDOM.clientHeight);
      });
    }
    const lines = view.state.doc.lines;
    const scale = 2;
    canvas.width = 46; canvas.height = Math.min(lines * scale + 4, 12000);
    const c = canvas.getContext('2d');
    c.clearRect(0, 0, canvas.width, canvas.height);
    const css = getComputedStyle(document.documentElement);
    c.fillStyle = css.getPropertyValue('--muted') || '#888';
    const text = view.state.doc.toString();
    const ls = text.split('\n');
    for (let i = 0; i < ls.length; i++) {
      const t = ls[i];
      const indent = (t.match(/^\s*/) || [''])[0].length;
      const len = Math.min(42, Math.max(2, (t.trim().length * .55) | 0));
      c.globalAlpha = /^\s*(\/\/|\/\*|<!--|#|\*)/.test(t) ? .3 : .62;
      c.fillRect(2 + Math.min(indent, 12), i * scale + 2, len, 1.2);
    }
    c.globalAlpha = 1;
  }, 100);
}

/* ── breadcrumbs / cursor status ───────────────────────────────────── */
function updateCursor(pane, view) {
  const sel = view.state.selection.main;
  const line = view.state.doc.lineAt(sel.head);
  const col = sel.head - line.from + 1;
  const posEl = $(`[data-pos="${pane}"]`);
  if (posEl) posEl.textContent = `${line.number}:${col}` + (sel.empty ? '' : ` (${Math.abs(sel.to - sel.from)} выд.)`);
  if (state.activePane === pane) {
    $('#statusPos') && ($('#statusPos').textContent = `Стр ${line.number}, Стл ${col}`);
    $('#statusFile') && ($('#statusFile').textContent = state.panes[pane] || '—');
    $('#statusLang') && ($('#statusLang').textContent = langName(pane));
  }
  const crumb = $(`[data-crumbs="${pane}"]`);
  if (crumb && state.settings.breadcrumbs) crumb.innerHTML = breadcrumbs(pane, view.state, sel.head);
  emit('cursor', { pane, line: line.number, col, pos: sel.head });
}
function breadcrumbs(pane, st, pos) {
  const before = st.doc.sliceString(0, pos);
  const file = esc(state.panes[pane] || '');
  if (pane === 'html') {
    const stack = [];
    const re = /<(\/?)([a-zA-Z][\w-]*)([^>]*)>/g; let m;
    while ((m = re.exec(before))) {
      if (m[1]) { const i = stack.map(x => x.t).lastIndexOf(m[2]); if (i >= 0) stack.splice(i); }
      else if (!/^(br|img|input|meta|link|hr|source|area|base|col|embed|param|track|wbr)$/i.test(m[2])) {
        const id = /id=["']([^"']+)/.exec(m[3]);
        stack.push({ t: m[2], id: id ? '#' + id[1] : '' });
      }
    }
    return [file, ...stack.slice(-4).map(x => `<b>${esc(x.t)}</b>${esc(x.id)}`)].join(' › ');
  }
  if (pane === 'css') {
    const sels = [...before.matchAll(/([^{}]+)\{/g)].map(m => m[1].trim().split('\n').pop());
    return [file, ...sels.slice(-2).map(s => `<b>${esc(s.slice(0, 34))}</b>`)].join(' › ');
  }
  const fns = [...before.matchAll(/(?:function\s+([\w$]+)|(?:const|let|var)\s+([\w$]+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>)/g)].map(m => m[1] || m[2]);
  return [file, ...fns.slice(-2).map(s => `<b>${esc(s)}()</b>`)].join(' › ');
}

/* ── editor creation ───────────────────────────────────────────────── */
export function initEditors() {
  for (const pane of PANES) {
    const host = $(`[data-cm="${pane}"]`);
    if (!host) continue;
    langComp[pane] = new Compartment();
    prefComp[pane] = new Compartment();
    readComp[pane] = new Compartment();
    const path = state.panes[pane] || '';
    const view = new EditorView({
      state: EditorState.create({
        doc: exists(path) ? read(path) : '',
        extensions: [
          lineNumbers(), highlightActiveLineGutter(), highlightSpecialChars(),
          history(), drawSelection(), dropCursor(), rectangularSelection(),
          crosshairCursor(), highlightActiveLine(), highlightSelectionMatches(),
          foldGutter(), bracketMatching(), closeBrackets(), indentOnInput(),
          syntaxHighlighting(highlight), regionFold,
          autocompletion({ override: [completionSource], activateOnTyping: true, maxRenderedOptions: 22 }),
          linter(lintSource, { delay: 650 }), lintGutter(),
          hover, colorPlugin, cmTheme,
          langComp[pane].of(languageFor(pane, path)),
          prefComp[pane].of(prefExtensions()),
          readComp[pane].of(readOnlyExtensions()),
          EditorState.allowMultipleSelections.of(true),
          EditorState.tabSize.of(state.settings.tabSize),
          keymap.of([
            ...defaultKeymap, ...historyKeymap, ...foldKeymap, ...searchKeymap,
            ...lintKeymap, ...closeBracketsKeymap, ...completionKeymap, indentWithTab
          ]),
          EditorView.updateListener.of(u => {
            const p = state.panes[pane];
            if (u.docChanged && !internal[pane]) {
              const content = u.state.doc.toString();
              if (state.readOnly) { /* read-only share mode: visual only */ }
              else write(p, content, { fromPane: pane, quiet: true });
              updateMinimap(pane);
            }
            if (u.docChanged || u.selectionSet || u.focusChanged) updateCursor(pane, u.view);
            if (u.focusChanged && u.view.hasFocus) {
              state.activePane = pane; state.activeFile = state.panes[pane];
              emit('pane:active', pane);
            }
          })
        ]
      }),
      parent: host
    });
    view.dom.dataset.pane = pane;
    view.dom.addEventListener('runlet-color', e => openColorPicker(pane, e.detail));
    editors[pane] = view;
    updateMinimap(pane);
  }
  on('file:externalChange', ({ pane, path, content }) => {
    if (!editors[pane] || state.panes[pane] !== path) return;
    loadDoc(pane, content);
  });
  on('project:restoreEditors', () => {
    for (const p of PANES) {
      const path = state.panes[p];
      if (!editors[p]) continue;
      loadDoc(p, exists(path) ? read(path) : '', path);
      $(`[data-pane-file="${p}"]`) && ($(`[data-pane-file="${p}"]`).textContent = path || '—');
    }
  });
  on('settings:changed', applyEditorSettings);
  on('readOnly:changed', v => setEditorsReadOnly(v));
  on('analysis:report', () => { for (const p of PANES) if (editors[p]) forceLinting(editors[p]); });
  on('pane:goto', ({ pane, line, col }) => goto(pane, line, col));
  on('files:changed', () => { /* status bar */ });
}

function readOnlyExtensions() {
  return [EditorState.readOnly.of(!!state.readOnly), EditorView.editable.of(!state.readOnly)];
}
export function setEditorsReadOnly(v) {
  state.readOnly = !!v;
  for (const pane of PANES) {
    const view = editors[pane]; if (!view || !readComp[pane]) continue;
    view.dispatch({ effects: readComp[pane].reconfigure(readOnlyExtensions()) });
  }
}
function prefExtensions() {
  const s = state.settings;
  return [
    EditorState.tabSize.of(s.tabSize),
    s.wrap ? EditorView.lineWrapping : [],
    s.showWhitespace ? highlightWhitespace() : [],
    s.showInvisibles ? highlightSpecialChars() : [],
    EditorView.theme({
      '.cm-content': {
        fontSize: s.fontSize + 'px', lineHeight: String(s.lineHeight),
        fontFamily: 'var(--mono)'
      },
      '.cm-cursor': { borderLeftWidth: s.cursorStyle === 'block' ? '0' : '2px',
                      background: s.cursorStyle === 'block' ? 'var(--accent)' : 'transparent' },
      '.cm-scroller': { scrollBehavior: s.smoothScroll ? 'smooth' : 'auto' }
    })
  ];
}
export function applyEditorSettings() {
  for (const pane of PANES) {
    const view = editors[pane]; if (!view) continue;
    view.dispatch({ effects: [
      prefComp[pane].reconfigure(prefExtensions()),
      langComp[pane].reconfigure(languageFor(pane, state.panes[pane])),
      readComp[pane].reconfigure(readOnlyExtensions())
    ] });
    updateMinimap(pane);
    const mm = $(`[data-minimap="${pane}"]`); if (mm) mm.style.display = state.settings.minimap ? '' : 'none';
  }
  applyThemeToPanes();
}
function applyThemeToPanes() {
  // re-render syntax colors after a theme change
  for (const pane of PANES) editors[pane]?.requestMeasure();
}

export function loadDoc(pane, content, path) {
  const view = editors[pane]; if (!view) return;
  internal[pane] = true;
  try {
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: content } });
  } finally { internal[pane] = false; }
  if (path) {
    state.panes[pane] = path;
    view.dispatch({ effects: langComp[pane].reconfigure(languageFor(pane, path)) });
    const label = $(`[data-pane-file="${pane}"]`); if (label) label.textContent = path;
  }
  updateMinimap(pane);
}
export function setPaneFile(pane, path) {
  if (!exists(path)) return false;
  state.panes[pane] = path; state.activePane = pane; state.activeFile = path;
  loadDoc(pane, read(path), path);
  emit('pane:active', pane);
  emit('project:size');
  return true;
}
export function getActiveEditor() { return editors[state.activePane] || editors.html; }
export function activePane() { return state.activePane; }
export function focusPane(pane) {
  state.activePane = pane; state.activeFile = state.panes[pane];
  editors[pane]?.focus(); emit('pane:active', pane);
}
export function getDoc(pane = state.activePane) { return editors[pane]?.state.doc.toString() || ''; }
export function setDoc(content, pane = state.activePane) {
  const view = editors[pane]; if (!view) return;
  internal[pane] = true;
  try { view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: content } }); }
  finally { internal[pane] = false; }
  write(state.panes[pane], content, { fromPane: pane });
  updateMinimap(pane);
}
export function replaceRange(from, to, text, pane = state.activePane) {
  const view = editors[pane]; if (!view) return;
  view.dispatch({ changes: { from, to, insert: text } });
}
export function getSelection(pane = state.activePane) {
  const v = editors[pane]; if (!v) return '';
  const s = v.state.selection.main;
  return v.state.doc.sliceString(s.from, s.to);
}
export function replaceSelection(text, pane = state.activePane) {
  const v = editors[pane]; if (!v) return;
  const s = v.state.selection.main;
  v.dispatch({ changes: { from: s.from, to: s.to, insert: text }, selection: { anchor: s.from + text.length } });
}
export function insertText(text, pane = state.activePane) {
  const v = editors[pane]; if (!v) return;
  const s = v.state.selection.main;
  v.dispatch({ changes: { from: s.from, to: s.to, insert: text }, selection: { anchor: s.from + text.length }, scrollIntoView: true });
}
export function goto(pane, line, col = 1, file = null) {
  if (file && state.panes[pane] !== file) {
    for (const [p, f] of Object.entries(state.panes)) if (f === file) { pane = p; break; }
    if (state.panes[pane] !== file) setPaneFile(pane, file);
  }
  const view = editors[pane]; if (!view) return;
  if (state.layout === 'tabs') ctx.setLayout?.('tabs', pane);
  focusPane(pane);
  try {
    const l = view.state.doc.line(Math.max(1, Math.min(line, view.state.doc.lines)));
    const pos = l.from + Math.max(0, (col || 1) - 1);
    view.dispatch({ selection: { anchor: pos }, scrollIntoView: true, effects: EditorView.scrollIntoView(pos, { y: 'center' }) });
  } catch (e) { /* ignore */ }
}

/* ── snippets, emmet, editing commands ─────────────────────────────── */
export function insertSnippet(code, pane = state.activePane) {
  const view = editors[pane]; if (!view) return;
  const sel = view.state.selection.main;
  snippet(escapeSnippet(code))(view, null, sel.from, sel.to);
  view.focus();
}
export function expandEmmet(pane = state.activePane) {
  const view = editors[pane]; if (!view) return false;
  const pos = view.state.selection.main.head;
  const line = view.state.doc.lineAt(pos);
  const before = line.text.slice(0, pos - line.from);
  const m = /([a-zA-Z][\w.#\[\]='$@{}*>+^():,-]*)$/.exec(before);
  if (!m) { toast('Поставьте курсор после Emmet-выражения', 'warn'); return false; }
  const expr = m[1];
  let out = '';
  if (pane === 'css') {
    const [key, val] = expr.split(/(\d+.*|#[0-9a-f]+|[\w-]+\(.*)/);
    const abbr = EMMET_CSS[expr.trim()];
    if (abbr) out = abbr.replace(/\$\{\d+:([^}]*)\}/g, '$1');
    else {
      const prop = CSS_PROPS.find(p => p.startsWith(expr.trim()));
      if (prop) out = prop + ': ${1};';
    }
  } else {
    try { out = emmetHTML(expr); } catch (e) { return false; }
  }
  if (!out) { toast('Не удалось разобрать выражение: ' + expr, 'warn'); return false; }
  const from = pos - expr.length;
  view.dispatch({ changes: { from, to: pos, insert: '' } });
  if (out.includes('${')) snippet(escapeSnippet(out))(view, null, from, from);
  else view.dispatch({ changes: { from, insert: out }, selection: { anchor: from + out.length } });
  view.focus();
  return true;
}
export function emmetHTML(expr) {
  const implicit = { '.': 'div', '#': 'div', '>': 'div' };
  function parseOne(seg) {
    let s = seg, text = '', count = 1;
    const txt = /\{([^}]*)\}/.exec(s); if (txt) { text = txt[1]; s = s.replace(txt[0], ''); }
    const rep = /\*(\d+)$/.exec(s); if (rep) { count = Math.min(30, +rep[1]); s = s.replace(rep[0], ''); }
    let tag = /^[a-zA-Z][\w-]*/.exec(s)?.[0] || 'div';
    s = s.slice(tag.length);
    const id = /#([\w-]+)/.exec(s);
    const classes = [...s.matchAll(/\.([\w-]+)/g)].map(m => m[1]);
    const attrs = [...s.matchAll(/\[([^\]]+)\]/g)].map(m => m[1].replace(/^([^=]+)$/, '$1="$1"'));
    const attr = (id ? ` id="${id[1]}"` : '') + (classes.length ? ` class="${classes.join(' ')}"` : '') +
      attrs.map(a => ' ' + a).join('');
    const single = /^(img|input|br|hr|meta|link|source|area|base|col|embed|param|track|wbr)$/i.test(tag);
    const one = single ? `<${tag}${attr}>` : `<${tag}${attr}>${text || '${1}'}</${tag}>`;
    return Array.from({ length: count }, () => one).join('\n');
  }
  function expand(str) {
    // naive sibling/child expansion with parentheses
    let parts = str.split(/(?=[>+])/);
    let out = '', children = '';
    let current = '';
    for (const p of parts) {
      if (p.startsWith('>')) { children += expand(p.slice(1)); }
      else if (p.startsWith('+')) { out += '\n' + parseOne(p.slice(1)); }
      else current = p;
    }
    const base = current ? parseOne(current) : '';
    if (children) {
      const inner = expand(children);
      out = base.replace(/\$\{1\}/, inner).replace(/><\//, '>' + inner + '</');
    } else out = base + out;
    return out;
  }
  return expand(expr.replace(/\^/g, ''));
}
export function formatDoc(pane = state.activePane) {
  const view = editors[pane]; if (!view) return;
  const code = view.state.doc.toString();
  const opts = { indent_size: state.settings.tabSize, indent_char: ' ', max_preserve_newlines: 2,
                 wrap_line_length: 0, end_with_newline: true, indent_inner_html: true };
  let out = code;
  try {
    if (pane === 'html') out = beautify.html(code, opts);
    else if (pane === 'css') out = beautify.css(code, opts);
    else if (/\.json$/i.test(state.panes[pane])) out = JSON.stringify(JSON.parse(code), null, state.settings.tabSize);
    else out = beautify.js(code, opts);
  } catch (e) { toast('Не удалось отформатировать: ' + e.message, 'err'); return; }
  if (state.settings.trimTrailingWhitespace) out = out.replace(/[ \t]+$/gm, '');
  setDoc(out, pane);
  toast('Код отформатирован', 'ok', langName(pane));
}
export function minifyDoc(pane = state.activePane) {
  const code = getDoc(pane); let out = code;
  if (pane === 'html') {
    out = code.replace(/<!--(?!\[if)[\s\S]*?-->/g, '')
      .replace(/>\s+</g, '><').replace(/\s{2,}/g, ' ').replace(/\n/g, '').trim();
  } else if (pane === 'css') {
    out = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s*([{}:;,>])\s*/g, '$1')
      .replace(/;}/g, '}').replace(/\s+/g, ' ').trim();
  } else if (/\.json$/i.test(state.panes[pane])) {
    try { out = JSON.stringify(JSON.parse(code)); } catch (e) { toast('Невалидный JSON', 'err'); return; }
  } else {
    out = code.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => l.replace(/\s*\/\/(?![^"']*["']).*$/, '')).join('\n')
      .replace(/\s*([{}();,:=+<>?])\s*/g, '$1').replace(/\n+/g, '').trim();
  }
  setDoc(out, pane);
  toast(`Минификация: ${code.length} → ${out.length} символов`, 'ok', langName(pane));
}
export function trimTrailing(pane = state.activePane) { setDoc(getDoc(pane).replace(/[ \t]+$/gm, ''), pane); }
export function tabsToSpaces(pane = state.activePane) {
  const n = state.settings.tabSize || 2;
  setDoc(getDoc(pane).replace(/\t/g, ' '.repeat(n)), pane);
}
export function spacesToTabs(pane = state.activePane) {
  const n = state.settings.tabSize || 2;
  setDoc(getDoc(pane).replace(new RegExp(' '.repeat(n), 'g'), '\t'), pane);
}
export function sortCssProps(pane = 'css') {
  const code = getDoc(pane);
  const out = code.replace(/\{([^{}]*)\}/g, (m, body) => {
    const decls = body.split(';').map(s => s.trim()).filter(Boolean);
    const groups = { position: [], box: [], typography: [], visual: [], other: [] };
    for (const d of decls) {
      const p = (d.split(':')[0] || '').trim();
      if (/^(position|top|right|bottom|left|z-index|inset|float|clear|display|overflow)/.test(p)) groups.position.push(d);
      else if (/^(width|height|margin|padding|border|box|flex|grid|gap|min-|max-)/.test(p)) groups.box.push(d);
      else if (/^(font|text|line|letter|word|white|color)/.test(p)) groups.typography.push(d);
      else if (/^(background|opacity|filter|transform|transition|animation|clip|mask)/.test(p)) groups.visual.push(d);
      else groups.other.push(d);
    }
    return '{\n  ' + Object.values(groups).flat().sort((a, b) => a.localeCompare(b)).join(';\n  ') + ';\n}';
  });
  setDoc(out, pane); toast('CSS-свойства сгруппированы и отсортированы', 'ok');
}
/* Folding must be reversible from the same command: previously "Свернуть всё"
   only ever folded and there was no obvious way back for a collapsed block. */
const foldedPanes = new Set();
export function toggleFoldAll(pane = state.activePane) {
  const view = editors[pane]; if (!view) return false;
  if (foldedPanes.has(pane)) { unfoldAll(view); foldedPanes.delete(pane); return false; }
  foldAll(view); foldedPanes.add(pane); return true;
}
export function unfoldAllPane(pane = state.activePane) {
  const view = editors[pane]; if (!view) return;
  unfoldAll(view); foldedPanes.delete(pane);
}
export function isPaneFolded(pane = state.activePane) { return foldedPanes.has(pane); }
export function cmCommand(name) {
  const v = getActiveEditor(); if (!v) return;
  const map = {
    duplicateLine: copyLineDown, moveLineUp, moveLineDown,
    toggleComment, selectAll, selectNextOccurrence, selectSelectionMatches,
    startCompletion, deleteTrailingWhitespace
  };
  const fn = map[name];
  if (fn) { fn(v); v.focus(); }
  else if (name === 'find') { openSearchPanel(v); v.focus(); }
}
export function openColorPicker(pane, detail) {
  const view = editors[pane];
  const inp = document.createElement('input');
  inp.type = 'color'; inp.value = /^#[0-9a-f]{6}$/i.test(detail.color) ? detail.color : '#888888';
  inp.style.cssText = 'position:fixed;opacity:0;pointer-events:none;width:1px;height:1px';
  document.body.appendChild(inp);
  inp.addEventListener('input', () => {
    const doc = view.state.doc.toString();
    const around = doc.slice(Math.max(0, detail.pos - 12), detail.pos + 12);
    const m = /#[0-9a-f]{3,8}/i.exec(around);
    if (m) {
      const from = Math.max(0, detail.pos - 12) + m.index;
      view.dispatch({ changes: { from, to: from + m[0].length, insert: inp.value } });
    }
  });
  inp.addEventListener('change', () => inp.remove());
  inp.click();
}
export function syncEditorLabels() {
  for (const p of PANES) {
    const n = $(`[data-pane-file="${p}"]`);
    if (n) n.textContent = state.panes[p] || '—';
  }
}
