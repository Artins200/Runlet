/* Headless smoke test of the renderer using jsdom (no browser binary needed). */
import { JSDOM, VirtualConsole } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'app/index.html'), 'utf8');
const bundle = fs.readFileSync(path.join(root, 'app/dist/bundle.js'), 'utf8');
const vc = new VirtualConsole();
const errors = [];
vc.on('jsdomError', e => errors.push('jsdomError: ' + (e.stack || e.message)));
vc.on('error', (...a) => errors.push('console.error: ' + a.map(String).join(' ')));
vc.on('warn', (...a) => { /* ignore warnings */ });

const dom = new JSDOM(html, {
  url: 'http://localhost:4173/', runScripts: 'outside-only',
  pretendToBeVisual: true, virtualConsole: vc,
  beforeParse(w) {
    w.matchMedia = q => ({ matches: false, media: q, onchange: null,
      addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; } });
    w.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
    w.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
    w.PerformanceObserver = class { observe() {} disconnect() {} };
    w.BroadcastChannel = class { constructor() {} postMessage() {} close() {} onmessage = null; };
    w.fetch = (u, o) => globalThis.fetch(new URL(typeof u === 'string' ? u : u.url, 'http://localhost:4173/'), o);
    w.structuredClone = globalThis.structuredClone;
    w.CSS = { escape: s => String(s).replace(/[^a-zA-Z0-9_-]/g, c => '\\' + c) };
    w.HTMLCanvasElement.prototype.getContext = () => ({
      clearRect() {}, fillRect() {}, fillText() {}, drawImage() {}, createLinearGradient: () => ({ addColorStop() {} }),
      beginPath() {}, fill() {}, roundRect() {}, save() {}, restore() {}, translate() {}, scale() {},
      measureText: () => ({ width: 10 }), set fillStyle(v) {}, set font(v) {}, set globalAlpha(v) {}, set textAlign(v) {}, set textBaseline(v) {}
    });
    w.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,AA';
    w.Range.prototype.getClientRects = function () { return { length: 0, item: () => null, [Symbol.iterator]: function* () {} }; };
    w.Range.prototype.getBoundingClientRect = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 });
    w.Element.prototype.scrollIntoView = () => {};
    w.Element.prototype.setPointerCapture = () => {};
    w.HTMLElement.prototype.focus = w.HTMLElement.prototype.focus || function () {};
    w.performance.getEntriesByType = w.performance.getEntriesByType || (() => []);
    Object.defineProperty(w.navigator, 'clipboard', { value: { writeText: async () => {} }, configurable: true });
  }
});

const w = dom.window;
w.addEventListener('error', e => errors.push('window.error: ' + (e.error?.stack || e.message)));
w.addEventListener('unhandledrejection', e => errors.push('unhandledrejection: ' + e.reason));

try { w.eval(bundle); } catch (e) { errors.push('eval: ' + (e.stack || e)); }

await new Promise(r => setTimeout(r, 3500));

const checks = [];
const check = (name, cond, extra = '') => { checks.push({ name, ok: !!cond, extra }); };

check('window.Runlet API', !!w.Runlet);
check('CodeMirror editors created', w.document.querySelectorAll('.cm-editor').length >= 3,
  w.document.querySelectorAll('.cm-editor').length + ' editors');
check('file tree rendered', w.document.querySelectorAll('.tree-row').length >= 3,
  w.document.querySelectorAll('.tree-row').length + ' rows');
check('analysis report received', !!w.Runlet?.report?.(), w.Runlet?.report?.()?.engine || 'none');
check('analysis panel has score', /score-ring/.test(w.document.querySelector('#analysisPanel')?.innerHTML || ''));
check('preview iframe has srcdoc', (w.document.querySelector('#previewFrame')?.getAttribute('srcdoc') || w.document.querySelector('#previewFrame')?.srcdoc || '').length > 100);
check('command registry populated', w.Runlet?.commands?.size > 100, w.Runlet?.commands?.size + ' commands');
check('CSS variables applied', !!w.document.documentElement.style.getPropertyValue('--accent'));

// interaction: run a command through the palette registry
try { w.Runlet?.runCommand('layoutRows'); check('layoutRows command', w.document.querySelector('#editors')?.dataset.layout === 'rows'); }
catch (e) { check('layoutRows command', false, e.message); }
try { w.Runlet?.runCommand('theme'); check('theme command', true); }
catch (e) { check('theme command', false, e.message); }
try { w.Runlet?.runCommand('format'); check('format command', true); }
catch (e) { check('format command', false, e.message); }
try { w.Runlet?.runCommand('palette'); check('palette opens modal', w.document.querySelector('#modalRoot')?.classList.contains('show')); }
catch (e) { check('palette opens modal', false, e.message); }

console.log('\n=== Runlet smoke test ===');
for (const c of checks) console.log(`${c.ok ? '✅' : '❌'} ${c.name}${c.extra ? ' — ' + c.extra : ''}`);
console.log(`\nErrors captured: ${errors.length}`);
for (const e of errors.slice(0, 12)) console.log('  ⚠ ' + e.slice(0, 500));
const failed = checks.filter(c => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
dom.window.close();
process.exit(failed.length || (errors.length > 3 ? 1 : 0));
