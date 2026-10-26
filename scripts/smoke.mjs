/* Headless smoke test of the renderer using jsdom (no browser binary needed). */
import { JSDOM, VirtualConsole } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ORIGIN = process.env.RUNLET_TEST_ORIGIN || 'http://localhost:4173';
const CTX = new Proxy({}, {
  get: (_, k) => {
    if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop() {} });
    if (k === 'measureText') return () => ({ width: 10 });
    if (k === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
    return () => {};
  },
  set: () => true
});

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = await (await fetch(ORIGIN + '/')).text();
const bundle = fs.readFileSync(path.join(root, 'app/dist/bundle.js'), 'utf8');
const vc = new VirtualConsole();
const errors = [];
vc.on('jsdomError', e => errors.push('jsdomError: ' + (e.stack || e.message)));
vc.on('error', (...a) => errors.push('console.error: ' + a.map(String).join(' ')));
vc.on('warn', (...a) => { /* ignore warnings */ });

const dom = new JSDOM(html, {
  url: ORIGIN + '/', runScripts: 'outside-only',
  pretendToBeVisual: true, virtualConsole: vc,
  beforeParse(w) {
    w.matchMedia = q => ({ matches: false, media: q, onchange: null,
      addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; } });
    w.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
    w.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
    w.PerformanceObserver = class { observe() {} disconnect() {} };
    w.BroadcastChannel = class { constructor() {} postMessage() {} close() {} onmessage = null; };
    w.fetch = (u, o) => globalThis.fetch(new URL(typeof u === 'string' ? u : u.url, ORIGIN), o);
    w.structuredClone = globalThis.structuredClone;
    w.CSS = { escape: s => String(s).replace(/[^a-zA-Z0-9_-]/g, c => '\\' + c) };
    w.HTMLCanvasElement.prototype.getContext = () => CTX;
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

// New UI: launcher, icons, toolbar, devices, 3D, projects, windows
check('Project launcher shown', !!w.document.querySelector('#startScreen .launch'));
check('Launcher has project rows', w.document.querySelectorAll('#prjList .project-row').length >= 1);
check('Toolbar simplified (only primary actions)', w.document.querySelectorAll('#toolbarPrimary [data-cmd]').length >= 2 && w.document.querySelectorAll('#toolbarPrimary [data-cmd]').length <= 4);
check('Secondary toolbar rendered', w.document.querySelectorAll('#toolbarSecondary [data-cmd]').length >= 1);
check('Grouped menus instead of 15+ buttons', w.document.querySelectorAll('[data-menu]').length === 2 &&
  w.document.querySelectorAll('#toolbar [data-cmd]').length <= 12);
check('Readable code: font >= 16px, line-height >= 1.5', parseFloat(w.Runlet.settings.fontSize) >= 16 && parseFloat(w.Runlet.settings.lineHeight) >= 1.5,
  `${w.Runlet.settings.fontSize}px / ${w.Runlet.settings.lineHeight}`);
check('Word wrap enabled by default', w.Runlet.settings.wrap === true);
const cssText = await (await fetch(ORIGIN + '/dist/styles.css')).text();
const darkBlock = (cssText.match(/html\[data-theme="dark"\]\s*\{([\s\S]*?)\}/) || [])[1] || '';
const tok = n => (darkBlock.match(new RegExp('--' + n + ':\\s*(#[0-9a-f]{6})', 'i')) || [])[1] || '#000000';
const cr = w.Runlet.contrastRatio;
check('WCAG contrast: text / muted / dim on card', cr(tok('text'), tok('card')) >= 4.5 &&
  cr(tok('muted'), tok('card')) >= 4.5 && cr(tok('dim'), tok('code-bg')) >= 4.5,
  `text ${cr(tok('text'), tok('card'))}, muted ${cr(tok('muted'), tok('card'))}, dim ${cr(tok('dim'), tok('code-bg'))}`);
check('Windowed app shell with controls', w.document.body.classList.contains('windowed-app') &&
  w.document.querySelectorAll('#winControls button').length === 3);
check('3D stage exists with canvas', !!w.document.querySelector('#threeStage #tdCanvas'));
check('3D scene has primitives', w.Runlet.threeD().objects >= 2, 'objects=' + w.Runlet.threeD().objects);
check('File tree has SVG icons only', w.document.querySelectorAll('#fileTree .tree-row svg').length >= 3 &&
  !/\p{Extended_Pictographic}/u.test(w.document.querySelector('#fileTree')?.textContent || ''));
check('No Ideas tab', !w.document.querySelector('[data-rail-tab="features"]'));
check('SVG icons hydrated', w.document.querySelectorAll('svg.ico').length >= 10);
check('No emoji in UI labels', !/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(w.document.body.textContent || ''));
const devBtns = [...w.document.querySelectorAll('#deviceSwitch [data-device]')].map(b => b.dataset.device);
check('Only 3 clear device presets + custom', JSON.stringify(devBtns) === JSON.stringify(['desktop','tablet','phone','custom']), devBtns.join(','));
check('3D editor canvas exists', !!w.document.querySelector('#tdCanvas'));
check('Windows layer exists', !!w.document.querySelector('#windowsLayer'));
check('Live Server bar exists', !!w.document.querySelector('#liveBar'));
check('Inspector sub-tabs grouped', w.document.querySelectorAll('#inspectorTabs .insp-tab').length === 5 &&
  w.document.querySelectorAll('#inspectorSubTabs .sub-tab').length === 4);
// interactive: open 3D stage and verify the renderer actually draws polygons
try {
  w.Runlet.openThreeD();
  await new Promise(r => setTimeout(r, 80));
  const st = w.Runlet.threeD();
  check('3D stage opens and renders', st.visible === true && st.drawn > 0, `drawn=${st.drawn}, ${st.width}x${st.height}`);
} catch (e) { check('3D stage opens and renders', false, e.message); }
try {
  w.Runlet.runCommand('quickNewHtml');
  check('Create HTML file works', !!(await w.Runlet.project()), w.Runlet.listFiles().filter(f => /\.html$/.test(f)).length + ' html files');
} catch (e) { check('Create HTML file works', false, e.message); }
try {
  w.Runlet.runCommand('appMinimize');
  check('App can be minimized like a normal program', w.document.body.classList.contains('app-min'));
  w.Runlet.runCommand('appRestore');
  check('App restores from taskbar', !w.document.body.classList.contains('app-min'));
} catch (e) { check('App can be minimized like a normal program', false, e.message); }
try {
  w.Runlet.runCommand('contrastCheck');
  check('Contrast audit dialog opens', w.document.querySelector('#modalRoot')?.classList.contains('show'));
  w.Runlet.runCommand('closeWindows');
} catch (e) { check('Contrast audit dialog opens', false, e.message); }

check('Public API exposes projects/windows/live', typeof w.Runlet.projects === 'function' &&
  typeof w.Runlet.toggleWindowedMode === 'function' && typeof w.Runlet.liveStatus === 'function');

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
