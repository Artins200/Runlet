/* Regression: the app must never minimize / restore / recreate its window
   by itself, and every menu command must run exactly once. */
import { JSDOM, VirtualConsole } from 'jsdom';
import fs from 'node:fs';

const ORIGIN = process.env.RUNLET_TEST_ORIGIN || 'http://localhost:4173';
const html = await (await fetch(ORIGIN + '/')).text();
const bundle = fs.readFileSync('app/dist/bundle.js', 'utf8');
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`);
  cond ? pass++ : fail++;
};

const CTX = new Proxy({}, {
  get: (_, k) => {
    if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop() {} });
    if (k === 'measureText') return () => ({ width: 10 });
    if (k === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
    return () => {};
  },
  set: () => true
});

function makeMockElectron(log, frame = true) {
  return {
    isElectron: true,
    platform: 'linux',
    versions: { electron: '45', node: '22', chrome: '130' },
    frameStatus: async () => { log.frameStatus++; return { frame }; },
    setFrame: async v => { log.setFrame++; log.lastFrameArg = v; return { ok: true, changed: false }; },
    windowControl: async a => { log.windowControl.push(a); return true; },
    analyze: async () => ({ ok: false, error: 'mock' }),
    onMenu: () => {},
    pythonCheck: async () => ({ available: false }),
    popout: async () => true,
    openExternal: async () => true,
    invoke: async () => null,
    openFile: async () => null,
    saveFile: async () => true,
    readFile: async () => null,
    writeFile: async () => true,
    openFolder: async () => null,
    saveProject: async () => ({ ok: true }),
    liveStart: async () => ({ ok: false }),
    liveUpdate: async () => ({ ok: false }),
    liveStop: async () => ({ ok: true }),
    liveStatus: async () => ({ ok: false }),
    liveExternal: async () => true
  };
}

async function boot({ electron = false, frame = true, wait = 2600 } = {}) {
  const log = { setFrame: 0, frameStatus: 0, windowControl: [], lastFrameArg: null };
  const vc = new VirtualConsole();
  const errors = [];
  vc.on('jsdomError', e => errors.push(e.message));
  vc.on('error', (...a) => errors.push(a.map(String).join(' ')));
  const dom = new JSDOM(html, {
    url: ORIGIN + '/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.matchMedia = q => ({ matches: false, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
      w.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
      w.IntersectionObserver = w.ResizeObserver;
      w.PerformanceObserver = class { observe() {} disconnect() {} };
      w.BroadcastChannel = class { postMessage() {} close() {} };
      w.fetch = (u, o) => globalThis.fetch(new URL(u, ORIGIN), o);
      w.structuredClone = globalThis.structuredClone;
      w.CSS = { escape: s => s };
      w.HTMLCanvasElement.prototype.getContext = () => CTX;
      w.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,AA';
      w.Range.prototype.getClientRects = function () { return { length: 0, item: () => null, [Symbol.iterator]: function* () {} }; };
      w.Range.prototype.getBoundingClientRect = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 });
      w.Element.prototype.scrollIntoView = () => {};
      w.Element.prototype.setPointerCapture = () => {};
      w.URL.createObjectURL = () => 'blob:mock';
      w.URL.revokeObjectURL = () => {};
      if (electron) w.runlet = makeMockElectron(log, frame);
    }
  });
  const w = dom.window;
  const classLog = [];
  const mo = new w.MutationObserver(recs => {
    for (const r of recs) classLog.push({ cls: w.document.body.className, t: Date.now() });
  });
  mo.observe(w.document.body, { attributes: true, attributeFilter: ['class'] });
  try { w.eval(bundle); } catch (e) { errors.push('eval: ' + e.message); }
  await new Promise(r => setTimeout(r, wait));
  return { w, dom, log, errors, classLog, mo };
}

const q = w => sel => w.document.querySelector(sel);

/* ── 1. Plain browser boot: no spontaneous minimize / restore ── */
{
  const { w, dom, errors, classLog, mo } = await boot();
  const $ = q(w);
  const spontaneous = classLog.filter(c => /app-min|app-closed|app-max/.test(c.cls));
  ok('Браузер: окно не сворачивается само', spontaneous.length === 0, `изменений: ${spontaneous.length}`);
  ok('Браузер: старт без ошибок', errors.length === 0, errors.slice(0, 2).join(' | '));
  ok('Браузер: приложение видно после загрузки', !w.document.body.classList.contains('app-min') &&
     w.document.querySelector('.app-shell') !== null);
  ok('Браузер: API загружен', !!w.Runlet);
  mo.disconnect(); dom.window.close();
}

/* ── 2. Electron boot: setFrame must NEVER be called automatically ── */
{
  const { w, dom, log, errors, mo } = await boot({ electron: true, wait: 2800 });
  ok('Electron: setFrame НЕ вызывается при старте', log.setFrame === 0, `вызовов: ${log.setFrame}`);
  ok('Electron: frameStatus запрошен один раз', log.frameStatus === 1, `вызовов: ${log.frameStatus}`);
  ok('Electron: настройка рамки синхронизирована', w.Runlet?.settings.nativeFrame === true);
  ok('Electron: нет самопроизвольных windowControl', log.windowControl.length === 0, log.windowControl.join(','));
  ok('Electron: старт без ошибок', errors.length === 0, errors.slice(0, 2).join(' | '));
  mo.disconnect(); dom.window.close();
}

/* ── 2b. The exact reported case: saved frameless preference ── */
{
  const { w, dom, log, errors, mo } = await boot({ electron: true, frame: false, wait: 2600 });
  ok('Electron (frameless): setFrame НЕ вызывается при старте', log.setFrame === 0, `вызовов: ${log.setFrame}`);
  ok('Electron (frameless): рамка синхронизирована без пересоздания', w.Runlet?.settings.nativeFrame === false);
  ok('Electron (frameless): окно не дёргается', log.windowControl.length === 0);
  ok('Electron (frameless): старт без ошибок', errors.length === 0, errors.slice(0, 2).join(' | '));
  mo.disconnect(); dom.window.close();
}

/* ── 3. Menu commands run exactly once; minimize is explicit & stable ── */
{
  const { w, dom, errors, mo } = await boot({ wait: 2200 });
  const $ = q(w);
  // "Ещё" -> appMaximize: previously ran twice and flipped straight back.
  $('[data-menu="more"]')?.click();
  await new Promise(r => setTimeout(r, 60));
  const item = w.document.querySelector('[data-menu-item="appMaximize"]');
  ok('Меню содержит пункт разворачивания', !!item);
  item?.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 120));
  ok('Команда из меню выполняется ровно один раз', w.document.body.classList.contains('app-max'),
     'body=' + w.document.body.className);
  // restore state
  w.Runlet.runCommand('appRestore');

  // Minimize via titlebar button, then make sure nothing restores it by itself.
  const minBtn = w.document.querySelector('#winControls button[title="Свернуть"]');
  ok('Кнопка сворачивания существует', !!minBtn);
  minBtn?.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 250));
  ok('Сворачивание работает по клику', w.document.body.classList.contains('app-min'));
  await new Promise(r => setTimeout(r, 900));
  ok('Окно не восстанавливается само', w.document.body.classList.contains('app-min'));
  w.document.querySelector('.taskbar-app')?.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 120));
  ok('Восстановление работает по клику', !w.document.body.classList.contains('app-min'));
  ok('Оконный режим не открывает 3D сам', !$('#threeStage')?.classList.contains('show'));
  w.Runlet.runCommand('toggleWindowedMode');
  await new Promise(r => setTimeout(r, 150));
  ok('Оконный режим не открывает 3D-сцену', !$('#threeStage')?.classList.contains('show'));
  ok('Интерактивные сценарии без ошибок', errors.length === 0, errors.slice(0, 2).join(' | '));
  mo.disconnect(); dom.window.close();
}

/* ── 4. Static guards ── */
{
  const main = fs.readFileSync('app/src/main.js', 'utf8');
  const shell = fs.readFileSync('app/src/core/shellui.js', 'utf8');
  ok('В boot нет вызова setFrame', !/window\.runlet\?\.setFrame\s*&&\s*!state\.settings\.nativeFrame/.test(main) &&
     !/if \(window\.runlet\?\.setFrame/.test(main));
  ok('В boot нет авто-восстановления плавающих окон', !/setTimeout\(\(\) => toggleWindowedMode\(\)/.test(main));
  ok('Пункты меню не дублируют data-cmd', /data-menu-item/.test(shell) && !/'data-cmd': id/.test(shell));
}

console.log(`\n${pass} прошло, ${fail} упало (стабильность окна).\n`);
process.exit(fail ? 1 : 0);
