/* Exercise ~60 commands/dialogs in jsdom and report any runtime exception. */
import { JSDOM, VirtualConsole } from 'jsdom';
import fs from 'node:fs';

const ORIGIN = process.env.RUNLET_TEST_ORIGIN || 'http://localhost:4173';

const html = await (await fetch(ORIGIN + '/')).text();
const bundle = fs.readFileSync('app/dist/bundle.js', 'utf8');
const vc = new VirtualConsole();
const errors = [];
vc.on('jsdomError', e => { if (!/Not implemented: navigation|HTMLFormElement/.test(e.message)) errors.push(e.message); });
vc.on('error', (...a) => errors.push(a.map(String).join(' ').slice(0, 300)));
const dom = new JSDOM(html, {
  url: ORIGIN + '/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc,
  beforeParse(w) {
    w.matchMedia = q => ({ matches: false, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
    w.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
    w.IntersectionObserver = w.ResizeObserver;
    w.PerformanceObserver = class { observe() {} disconnect() {} };
    w.BroadcastChannel = class { postMessage() {} close() {} };
    w.fetch = (u, o) => globalThis.fetch(new URL(u, ORIGIN), o);
    w.structuredClone = globalThis.structuredClone; w.CSS = { escape: s => s };
    w.HTMLCanvasElement.prototype.getContext = () => ({ clearRect() {}, fillRect() {}, fillText() {}, drawImage() {}, createLinearGradient: () => ({ addColorStop() {} }), beginPath() {}, fill() {}, roundRect() {}, set fillStyle(v) {}, set font(v) {}, set globalAlpha(v) {}, set textAlign(v) {}, set textBaseline(v) {} });
    w.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,AA';
    w.Range.prototype.getClientRects = function () { return { length: 0, item: () => null, [Symbol.iterator]: function* () {} }; };
    w.Range.prototype.getBoundingClientRect = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 });
    w.Element.prototype.scrollIntoView = () => {}; w.Element.prototype.setPointerCapture = () => {};
    w.URL.createObjectURL = () => 'blob:mock'; w.URL.revokeObjectURL = () => {};
    w.open = () => ({ document: { open() {}, write() {}, close() {} } });
  }
});
const w = dom.window;
w.addEventListener('error', e => errors.push('window: ' + (e.error?.message || e.message)));
w.eval(bundle);
await new Promise(r => setTimeout(r, 2000));

const ids = [
  'theme', 'density', 'layoutColumns', 'layoutRows', 'layoutTabs', 'collapsePane', 'fullscreenPane',
  'format', 'formatHtml', 'formatCss', 'formatJs', 'minifyHtml', 'minifyCss', 'minifyJs',
  'sortCss', 'trimTrailing', 'tabsToSpaces', 'spacesToTabs', 'foldAll', 'unfoldAll',
  'snippets', 'cssLab', 'jsTools', 'htmlTools', 'contrastTool', 'colorTool', 'librarySearch',
  'settings', 'shortcuts', 'tour', 'startScreen', 'analysisReport', 'fixAll', 'copyReport',
  'newFile', 'newFolder', 'versions', 'features', 'learn', 'plugins', 'pluginMarket',
  'generateSEO', 'extractCss', 'darkTheme', 'mockData', 'aiExplain', 'aiFix', 'aiTests',
  'aiDocs', 'aiRefactor', 'aiPerf', 'a11yMarkup', 'breakpoint', 'refreshInspectors',
  'rotateDevice', 'toggleGrid', 'toggleRulers', 'inspectMode', 'previewFullscreen',
  'benchmark', 'lighthouse', 'bundleSize', 'lazyLoad', 'offlineCheck', 'coldStart',
  'workflow', 'gitlabCI', 'embed', 'cli', 'webhook', 'restApi', 'terminalPlugin',
  'quiz', 'recipes', 'visualizations', 'teacherMode', 'screenReader', 'a11yReport',
  'keyboardCheck', 'schemeEmulation', 'rtl', 'emulateReducedMotion', 'reloadPreview',
  'consoleClear', 'stepInto', 'resume', 'gotoLine', 'multiCursor', 'toggleComment',
  'findInProject', 'findReferences', 'securityScan', 'run'
];
let n = 0;
for (const id of ids) {
  const before = errors.length;
  try { w.Runlet?.runCommand(id); n++; } catch (e) { errors.push(`command ${id}: ${e.message}`); }
  // close any modal / overlay opened by the command
  try {
    w.document.querySelector('#modalRoot .close')?.click();
    w.document.querySelector('#tourLayer')?.classList.remove('show');
    w.document.querySelector('#startScreen')?.classList.remove('show');
  } catch (e) { errors.push('cleanup: ' + e.message); }
  const added = errors.length - before;
  if (added) console.log(`  ⚠ ${id}: ${errors.slice(before, before + added).join(' | ').slice(0, 220)}`);
}
await new Promise(r => setTimeout(r, 500));
console.log(`\nВыполнено команд: ${n}/${ids.length}`);
console.log(`Ошибок: ${errors.length}`);
for (const e of errors.slice(0, 15)) console.log('  • ' + e.slice(0, 300));
dom.window.close();
process.exit(errors.length ? 1 : 0);
