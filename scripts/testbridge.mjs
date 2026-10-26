/* Run the generated srcdoc in a second jsdom and verify the bridge protocol. */
import { JSDOM, VirtualConsole } from 'jsdom';
import fs from 'node:fs';
import * as acorn from 'acorn';

const ORIGIN = process.env.RUNLET_TEST_ORIGIN || 'http://localhost:4173';

const html = await (await fetch(ORIGIN + '/')).text();
const bundle = fs.readFileSync('app/dist/bundle.js', 'utf8');
const vc = new VirtualConsole();
const base = () => ({
  matchMedia: q => ({ matches: false, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }),
  ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
  PerformanceObserver: class { observe() {} disconnect() {} },
  BroadcastChannel: class { postMessage() {} close() {} },
  CSS: { escape: s => s },
  canvas: () => ({ clearRect() {}, fillRect() {}, fillText() {}, drawImage() {}, createLinearGradient: () => ({ addColorStop() {} }), beginPath() {}, fill() {}, roundRect() {}, set fillStyle(v) {}, set font(v) {}, set globalAlpha(v) {} })
});
function polyfill(w) {
  const b = base();
  w.matchMedia = b.matchMedia; w.ResizeObserver = b.ResizeObserver;
  w.IntersectionObserver = b.ResizeObserver; w.PerformanceObserver = b.PerformanceObserver;
  w.BroadcastChannel = b.BroadcastChannel; w.CSS = b.CSS;
  w.fetch = (u, o) => globalThis.fetch(new URL(typeof u === 'string' ? u : u.url, ORIGIN), o);
  w.structuredClone = globalThis.structuredClone;
  w.HTMLCanvasElement.prototype.getContext = b.canvas;
  w.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,AA';
  w.Range.prototype.getClientRects = function () { return { length: 0, item: () => null, [Symbol.iterator]: function* () {} }; };
  w.Range.prototype.getBoundingClientRect = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 });
  w.Element.prototype.scrollIntoView = () => {}; w.Element.prototype.setPointerCapture = () => {};
}

// 1. boot the editor to obtain srcdoc
const dom1 = new JSDOM(html, { url: ORIGIN + '/', runScripts: 'outside-only',
  pretendToBeVisual: true, virtualConsole: vc, beforeParse: polyfill });
dom1.window.eval(bundle);
await new Promise(r => setTimeout(r, 2200));
const srcdoc = dom1.window.document.querySelector('#previewFrame').getAttribute('srcdoc') || '';
dom1.window.close();
if (!srcdoc) { console.log('❌ no srcdoc'); process.exit(1); }

// 2. execute srcdoc with scripts enabled
const messages = [];
const errors = [];
const vc2 = new VirtualConsole();
vc2.on('jsdomError', e => errors.push(e.message));
vc2.on('error', (...a) => errors.push('console.error: ' + a.map(String).join(' ')));
const dom2 = new JSDOM(srcdoc, {
  url: ORIGIN + '/preview', runScripts: 'dangerously',
  pretendToBeVisual: true, virtualConsole: vc2,
  beforeParse(w) {
    polyfill(w);
    w.parent = { postMessage: (msg) => messages.push(msg) };
    w.alert = () => {};
  }
});
await new Promise(r => setTimeout(r, 1200));
const w = dom2.window;
// trigger a click on #btn
w.document.querySelector('#btn')?.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
await new Promise(r => setTimeout(r, 200));
// send a command from "editor"
const pfid = w.__RL_CFG__?.fid || '';
w.postMessage({ __rlcmd: true, fid: pfid, type: 'eval', data: { expr: '1 + 2', id: 7 } }, '*');
w.postMessage({ __rlcmd: true, fid: pfid, type: 'getDOM', data: {} }, '*');
w.postMessage({ __rlcmd: true, fid: pfid, type: 'getStorage', data: {} }, '*');
await new Promise(r => setTimeout(r, 300));

const check = (n, ok, extra = '') => console.log(`${ok ? '✅' : '❌'} ${n}${extra ? ' — ' + extra : ''}`);
const types = messages.map(m => m.type);
check('bridge sends ready', types.includes('ready'));
check('bridge sends perf', types.includes('perf'));
check('console.log intercepted after click', types.includes('console'), types.filter(t => t === 'console').length + ' logs');
check('eval command answered', types.includes('eval-result'), JSON.stringify(messages.find(m => m.type === 'eval-result')?.data?.value?.p || ''));
check('DOM tree command answered', types.includes('dom'));
check('storage command answered', types.includes('storage-all'));
check('no runtime errors', errors.length === 0, errors.slice(0, 2).join(' | ').slice(0, 300));
check('tracer recorded lines', (w.__RL?.trace?.length || 0) > 0, (w.__RL?.trace?.length || 0) + ' lines');
dom2.window.close();
process.exit(errors.length ? 1 : 0);
