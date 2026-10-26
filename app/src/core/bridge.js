/* The bridge is serialised with Function.prototype.toString() and injected into
   the sandboxed preview iframe. It must be 100% self-contained (no imports,
   no closure over module scope) and must not use backticks in a way that
   conflicts with the outer module — it is a plain function body. */

function bridgeMain() {
  var cfg = window.__RL_CFG__ || {};
  var fid = cfg.fid || 'rl';
  var files = cfg.files || {};
  var bp = cfg.breakpoints || {};
  var send = function (type, data) {
    try { parent.postMessage({ __runlet: true, fid: fid, type: type, data: data }, '*'); } catch (e) { }
  };
  var MAX = 30;
  function ser(v, depth) {
    depth = depth || 0;
    var t = typeof v;
    if (v === null) return { k: 'null', p: 'null', v: 'null' };
    if (t === 'undefined') return { k: 'undefined', p: 'undefined', v: 'undefined' };
    if (t === 'number' || t === 'boolean' || t === 'bigint') return { k: t, p: String(v), v: String(v) };
    if (t === 'string') return { k: 'string', p: v.length > 300 ? v.slice(0, 300) + '…' : v, v: v };
    if (t === 'symbol') return { k: 'symbol', p: String(v), v: String(v) };
    if (t === 'function') return { k: 'function', p: 'ƒ ' + (v.name || 'anonymous') + '()', v: String(v).slice(0, 400) };
    if (v instanceof Error) return { k: 'error', p: v.name + ': ' + v.message, v: (v.stack || '').slice(0, 2000) };
    if (v instanceof Element) return { k: 'element', p: '<' + v.tagName.toLowerCase() + '>', v: v.outerHTML.slice(0, 800) };
    if (depth > 2) return { k: 'deep', p: Array.isArray(v) ? '[…]' : '{…}', v: '…' };
    try {
      if (Array.isArray(v)) {
        var items = v.slice(0, MAX).map(function (x) { return ser(x, depth + 1); });
        return { k: 'array', p: 'Array(' + v.length + ')', v: items, json: JSON.stringify(v, replacer, 2).slice(0, 8000) };
      }
      var o = {};
      Object.keys(v).slice(0, MAX).forEach(function (k) { o[k] = ser(v[k], depth + 1); });
      return { k: 'object', p: (v.constructor && v.constructor.name || 'Object') + ' {' + Object.keys(v).slice(0, 5).join(', ') + '}', v: o, json: JSON.stringify(v, replacer, 2).slice(0, 8000) };
    } catch (e) { return { k: 'unknown', p: String(v), v: String(v) }; }
  }
  function replacer(k, v) {
    if (typeof v === 'function') return 'ƒ()';
    if (v instanceof Element) return '<' + v.tagName.toLowerCase() + '>';
    if (typeof v === 'bigint') return String(v);
    try { if (v && v.window === v) return '[Window]'; } catch (e) { }
    return v;
  }

  /* ── console ─────────────────────────────────────────────────── */
  var native = {};
  ['log', 'info', 'warn', 'error', 'debug'].forEach(function (level) {
    native[level] = console[level];
    console[level] = function () {
      var args = [].slice.call(arguments).map(function (a) { return ser(a); });
      send('console', { level: level, args: args, text: args.map(function (a) { return a.p; }).join(' '), time: Date.now() });
      try { native[level].apply(console, arguments); } catch (e) { }
    };
  });
  var times = {}, counters = {}, groupStack = [];
  console.table = function (data) {
    var rows = Array.isArray(data) ? data : Object.values(data || {});
    send('console', { level: 'table', args: [], text: 'console.table', table: rows.slice(0, 50).map(function (r) {
      if (r && typeof r === 'object') { var o = {}; Object.keys(r).slice(0, 8).forEach(function (k) { o[k] = String(r[k]); }); return o; }
      return { value: String(r) };
    }), time: Date.now() });
    native.log.apply(console, arguments);
  };
  console.time = function (label) { times[label || 'default'] = performance.now(); };
  console.timeEnd = function (label) {
    var key = label || 'default';
    send('console', { level: 'info', args: [], text: key + ': ' + (performance.now() - (times[key] || 0)).toFixed(2) + ' ms', time: Date.now() });
  };
  console.timeLog = console.timeEnd;
  console.group = function () { groupStack.push([].slice.call(arguments).join(' ')); send('console', { level: 'group', args: [], text: groupStack[groupStack.length - 1] || 'group', time: Date.now() }); };
  console.groupCollapsed = console.group;
  console.groupEnd = function () { groupStack.pop(); send('console', { level: 'groupEnd', args: [], text: '', time: Date.now() }); };
  console.assert = function (cond) { if (!cond) console.error.apply(console, ['Assertion failed:'].concat([].slice.call(arguments, 1))); };
  console.count = function (label) { counters[label || 'default'] = (counters[label || 'default'] || 0) + 1; console.log((label || 'default') + ': ' + counters[label || 'default']); };
  console.trace = function () { console.log(new Error('Trace').stack); };
  console.dir = function (v) { console.log(v); };
  console.clear = function () { send('console-clear', {}); };

  /* ── errors ──────────────────────────────────────────────────── */
  window.onerror = function (msg, src, line, col, err) {
    send('error', { text: String(msg), line: line || 0, col: col || 0, stack: err && err.stack || '', source: src || '' });
    return cfg.blockErrors !== false;
  };
  window.addEventListener('error', function (e) {
    if (e.target && e.target !== window && e.target.tagName) {
      send('error', { text: 'Ошибка загрузки ресурса: ' + (e.target.src || e.target.href || e.target.tagName), line: 0, stack: '' });
    }
  }, true);
  window.addEventListener('unhandledrejection', function (e) {
    var r = e.reason;
    send('error', { text: 'Unhandled promise rejection: ' + (r && r.message || r), line: 0, stack: r && r.stack || '' });
  });

  /* ── alerts → parent toasts ───────────────────────────────────── */
  window.alert = function (msg) { send('alert', { text: String(msg), level: 'info' }); };
  window.confirm = function (msg) { send('alert', { text: 'confirm(): ' + String(msg) + ' (вернулось false)', level: 'warn' }); return false; };
  window.prompt = function (msg, def) { send('alert', { text: 'prompt(): ' + String(msg), level: 'warn' }); return def || null; };
  window.print = function () { send('alert', { text: 'print() перехвачен', level: 'info' }); };

  /* ── isolated storage shim (opaque sandbox origin) ────────────── */
  function Shim() { this._d = {}; }
  Shim.prototype.getItem = function (k) { return Object.prototype.hasOwnProperty.call(this._d, String(k)) ? this._d[String(k)] : null; };
  Shim.prototype.setItem = function (k, v) { this._d[String(k)] = String(v); send('storage', { store: this._name, key: String(k), value: String(v) }); };
  Shim.prototype.removeItem = function (k) { delete this._d[String(k)]; };
  Shim.prototype.clear = function () { this._d = {}; };
  Shim.prototype.key = function (i) { return Object.keys(this._d)[i] || null; };
  Object.defineProperty(Shim.prototype, 'length', { get: function () { return Object.keys(this._d).length; } });
  var ls = new Shim(); ls._name = 'localStorage';
  var ss = new Shim(); ss._name = 'sessionStorage';
  try { Object.defineProperty(window, 'localStorage', { value: ls, configurable: true }); } catch (e) { }
  try { Object.defineProperty(window, 'sessionStorage', { value: ss, configurable: true }); } catch (e) { }

  /* ── local fetch + network tracking ──────────────────────────── */
  var network = [];
  function localContent(url) {
    var key = String(url).replace(/^\.?\//, '').split('?')[0].split('#')[0];
    if (Object.prototype.hasOwnProperty.call(files, key)) return files[key];
    var hit = Object.keys(files).filter(function (k) { return k.endsWith('/' + key); })[0];
    return hit ? files[hit] : null;
  }
  var nativeFetch = window.fetch;
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    var method = (init && init.method) || (input && input.method) || 'GET';
    var started = performance.now();
    var local = localContent(url);
    var rec = { url: url, method: method, status: 0, ms: 0, type: 'fetch', local: !!local };
    if (local != null) {
      rec.status = 200; rec.ms = 0; network.push(rec); send('network', rec);
      var body = /^data:/.test(local) ? decodeDataUri(local) : local;
      return Promise.resolve(new Response(body, { status: 200, headers: { 'Content-Type': guessType(url) } }));
    }
    return nativeFetch.apply(window, arguments).then(function (res) {
      rec.status = res.status; rec.ms = Math.round(performance.now() - started);
      network.push(rec); send('network', rec); return res;
    }, function (err) {
      rec.status = -1; rec.ms = Math.round(performance.now() - started);
      rec.error = String(err); network.push(rec); send('network', rec); throw err;
    });
  };
  function decodeDataUri(uri) {
    try {
      var comma = uri.indexOf(',');
      var meta = uri.slice(5, comma), payload = uri.slice(comma + 1);
      if (/;base64/i.test(meta)) {
        var bin = atob(payload), bytes = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return bytes.buffer;
      }
      return decodeURIComponent(payload);
    } catch (e) { return uri; }
  }
  function guessType(url) {
    var e = String(url).split('.').pop().toLowerCase();
    return ({ json: 'application/json', html: 'text/html', css: 'text/css', js: 'text/javascript',
              txt: 'text/plain', svg: 'image/svg+xml', xml: 'application/xml' })[e] || 'text/plain';
  }
  var XO = XMLHttpRequest.prototype.open, XS = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) { this.__rl = { method: method, url: url, t: performance.now() }; return XO.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function () {
    var self = this, r = this.__rl || {};
    this.addEventListener('loadend', function () {
      var rec = { url: r.url, method: r.method, status: self.status, ms: Math.round(performance.now() - (r.t || 0)), type: 'xhr' };
      network.push(rec); send('network', rec);
    });
    return XS.apply(this, arguments);
  };

  /* ── event listener inventory ────────────────────────────────── */
  var listeners = [];
  function describe(el) {
    if (!el) return 'unknown';
    if (el === window) return 'window';
    if (el === document) return 'document';
    try {
      var t = el.tagName ? el.tagName.toLowerCase() : 'object';
      if (el.id) t += '#' + el.id;
      else if (el.className && typeof el.className === 'string') t += '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.');
      return t;
    } catch (e) { return 'object'; }
  }
  var addOrig = EventTarget.prototype.addEventListener, remOrig = EventTarget.prototype.removeEventListener;
  EventTarget.prototype.addEventListener = function (type, fn, opts) {
    try { listeners.push({ type: String(type), target: describe(this), source: (fn && fn.toString() || '').slice(0, 160) }); } catch (e) { }
    return addOrig.call(this, type, fn, opts);
  };
  EventTarget.prototype.removeEventListener = function (type, fn, opts) {
    try { listeners = listeners.filter(function (l) { return !(l.type === type && l.target === describe(this)); }, this); } catch (e) { }
    return remOrig.call(this, type, fn, opts);
  };

  /* ── tracer / breakpoints ─────────────────────────────────────── */
  var trace = [], t0 = performance.now(), lastPause = 0;
  window.__RL = {
    trace: trace,
    t: function (file, line, scopeFn) {
      var vars = {};
      if (scopeFn) { try { vars = scopeFn() || {}; } catch (e) { vars = { error: String(e) }; } }
      var entry = { file: file, line: line, t: Math.round(performance.now() - t0),
                    vars: ser(vars).v, depth: (new Error()).stack.split('\n').length - 3 };
      trace.push(entry); if (trace.length > 3000) trace.shift();
      var rules = bp[file] || [];
      for (var i = 0; i < rules.length; i++) {
        var b = rules[i];
        if (b.line === line && b.enabled !== false) {
          var pass = true;
          if (b.condition) { try { pass = !!(0, eval)(b.condition); } catch (e) { pass = false; } }
          if (pass && performance.now() - lastPause > 200) {
            lastPause = performance.now();
            send('breakpoint', { file: file, line: line, index: trace.length - 1, vars: entry.vars, condition: b.condition || '' });
          }
        }
      }
      if (entry.t > (cfg.timeLimit || 4000) && !window.__RL_WARNED__) {
        window.__RL_WARNED__ = true;
        send('alert', { text: 'Скрипт работает дольше ' + (cfg.timeLimit || 4000) + ' мс — возможен бесконечный цикл', level: 'warn' });
      }
    },
    getTrace: function () { return trace; },
    clearTrace: function () { trace.length = 0; }
  };

  /* ── media queries / locale emulation ─────────────────────────── */
  var nativeMM = window.matchMedia;
  window.matchMedia = function (q) {
    var override = null;
    if (/prefers-color-scheme:\s*dark/.test(q) && cfg.scheme === 'dark') override = true;
    if (/prefers-color-scheme:\s*light/.test(q) && cfg.scheme === 'light') override = true;
    if (/prefers-color-scheme:\s*dark/.test(q) && cfg.scheme === 'light') override = false;
    if (/prefers-color-scheme:\s*light/.test(q) && cfg.scheme === 'dark') override = false;
    if (/prefers-reduced-motion:\s*reduce/.test(q) && cfg.motion === 'reduce') override = true;
    var mql = nativeMM.call(window, q);
    if (override !== null) {
      try {
        var wrapped = Object.create(mql);
        Object.defineProperty(wrapped, 'matches', { value: override, configurable: true });
        wrapped.addEventListener = mql.addEventListener ? mql.addEventListener.bind(mql) : function () { };
        wrapped.addListener = function () { };
        return wrapped;
      } catch (e) { return mql; }
    }
    return mql;
  };

  /* ── DOM inspection / hover / select ──────────────────────────── */
  function rectOf(el) {
    try { var r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }
    catch (e) { return { x: 0, y: 0, w: 0, h: 0 }; }
  }
  var lastHover = 0;
  document.addEventListener('mousemove', function (e) {
    var now = performance.now();
    if (now - lastHover < 55) return; lastHover = now;
    var el = e.target;
    send('hover', { rect: rectOf(el), tag: describe(el), text: (el.textContent || '').trim().slice(0, 60) });
  }, true);
  document.addEventListener('click', function (e) {
    var el = e.target;
    if (!cfg.inspect) return;
    e.preventDefault(); e.stopPropagation();
    send('select', {
      rect: rectOf(el), tag: describe(el), html: el.outerHTML.slice(0, 500),
      selector: cssPath(el), styles: computedStyles(el), text: (el.textContent || '').trim().slice(0, 120)
    });
  }, true);
  function cssPath(el) {
    if (!el || !el.tagName) return '';
    if (el.id) return '#' + el.id;
    var parts = [];
    while (el && el.nodeType === 1 && parts.length < 5) {
      var s = el.tagName.toLowerCase();
      if (el.className && typeof el.className === 'string') s += '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.');
      var parent = el.parentElement;
      if (parent) { var same = [].filter.call(parent.children, function (c) { return c.tagName === el.tagName; }); if (same.length > 1) s += ':nth-of-type(' + ([].indexOf.call(same, el) + 1) + ')'; }
      parts.unshift(s); el = parent;
    }
    return parts.join(' > ');
  }
  function computedStyles(el) {
    try {
      var cs = getComputedStyle(el), keys = ['display', 'position', 'width', 'height', 'margin', 'padding', 'color',
        'background-color', 'font-size', 'font-family', 'border-radius', 'box-shadow', 'z-index', 'opacity', 'transform', 'flex-direction', 'gap'];
      var o = {}; keys.forEach(function (k) { o[k] = cs.getPropertyValue(k); }); return o;
    } catch (e) { return {}; }
  }
  function domTree(node, depth, max) {
    depth = depth || 0; max = max || 5;
    if (!node || depth > max) return null;
    var kids = [];
    if (node.children) for (var i = 0; i < node.children.length && i < 40; i++) {
      var c = domTree(node.children[i], depth + 1, max); if (c) kids.push(c);
    }
    var attrs = {};
    if (node.attributes) for (var j = 0; j < node.attributes.length && j < 12; j++) attrs[node.attributes[j].name] = node.attributes[j].value.slice(0, 80);
    return { tag: node.tagName ? node.tagName.toLowerCase() : '#text', attrs: attrs, kids: kids, text: node.children && node.children.length === 0 ? (node.textContent || '').trim().slice(0, 60) : '' };
  }
  var formTimer = 0;
  document.addEventListener('input', function () {
    clearTimeout(formTimer);
    formTimer = setTimeout(function () { send('form-state', formState()); }, 250);
  }, true);
  document.addEventListener('change', function () { send('form-state', formState()); }, true);

  var hlStyle = null;
  function highlightEl(sel) {
    if (hlStyle) { hlStyle.remove(); hlStyle = null; }
    if (!sel) return;
    try {
      var el = document.querySelector(sel);
      if (!el) return;
      hlStyle = document.createElement('style');
      hlStyle.textContent = '[data-runlet-hl]{outline:2px solid #7c6cf6 !important; outline-offset:2px !important; background:rgba(124,108,246,.12) !important}';
      document.head.appendChild(hlStyle);
      document.querySelectorAll('[data-runlet-hl]').forEach(function (x) { x.removeAttribute('data-runlet-hl'); });
      el.setAttribute('data-runlet-hl', '');
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    } catch (e) { }
  }

  /* ── form state preservation ──────────────────────────────────── */
  function formState() {
    var data = {};
    document.querySelectorAll('input, textarea, select').forEach(function (el, i) {
      var key = el.id || el.name || ('el' + i);
      data[key] = el.type === 'checkbox' || el.type === 'radio' ? el.checked : el.value;
    });
    return { values: data, scrollX: scrollX, scrollY: scrollY };
  }
  function restoreForm(state) {
    if (!state || !state.values) return;
    Object.entries(state.values).forEach(function (kv) {
      var el = document.getElementById(kv[0]) || document.querySelector('[name="' + kv[0] + '"]');
      if (!el) return;
      if (el.type === 'checkbox' || el.type === 'radio') el.checked = !!kv[1]; else el.value = kv[1];
    });
    try { scrollTo(state.scrollX || 0, state.scrollY || 0); } catch (e) { }
  }

  /* ── performance metrics ──────────────────────────────────────── */
  var perf = { start: performance.now(), lcp: 0, cls: 0, fid: 0, longTasks: 0, resources: [] };
  try {
    var lcpObs = new PerformanceObserver(function (list) {
      for (var e of list.getEntries()) perf.lcp = Math.round(e.startTime);
      send('perf', perf);
    });
    lcpObs.observe({ type: 'largest-contentful-paint', buffered: true });
  } catch (e) { }
  try {
    new PerformanceObserver(function (list) {
      for (var e of list.getEntries()) if (!e.hadRecentInput) perf.cls += e.value;
      perf.cls = Math.round(perf.cls * 1000) / 1000; send('perf', perf);
    }).observe({ type: 'layout-shift', buffered: true });
  } catch (e) { }
  try {
    new PerformanceObserver(function (list) { perf.fid = Math.round(list.getEntries()[0].processingStart - list.getEntries()[0].startTime); send('perf', perf); })
      .observe({ type: 'first-input', buffered: true });
  } catch (e) { }
  try {
    new PerformanceObserver(function (list) { perf.longTasks += list.getEntries().length; send('perf', perf); })
      .observe({ type: 'longtask', buffered: true });
  } catch (e) { }

  /* ── commands from the editor ─────────────────────────────────── */
  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || !d.__rlcmd) return;
    var p = d.data || {};
    switch (d.type) {
      case 'eval': {
        var result, error = '';
        try { result = (0, eval)(p.expr); } catch (err) { error = String(err); }
        send('eval-result', { id: p.id, value: ser(result), error: error });
        break;
      }
      case 'hotcss': {
        var safeFile = String(p.file).replace(/["\\]/g, '\\$&');
        var style = document.querySelector('style[data-runlet="' + safeFile + '"]');
        if (!style) { var s = document.createElement('style'); s.setAttribute('data-runlet', p.file); document.head.appendChild(s); style = s; }
        style.textContent = p.css;
        send('alert', { text: 'CSS обновлён без перезагрузки', level: 'ok' });
        break;
      }
      case 'hotjs': {
        try { (0, eval)(p.code); send('alert', { text: 'JS перезапущен без перезагрузки', level: 'ok' }); }
        catch (err) { send('error', { text: 'Hot reload: ' + err.message, line: 0, stack: err.stack || '' }); }
        break;
      }
      case 'highlight': highlightEl(p.selector); break;
      case 'getDOM': send('dom', { tree: domTree(document.documentElement, 0, p.depth || 5) }); break;
      case 'getStyles': {
        var el = null; try { el = document.querySelector(p.selector); } catch (e2) { }
        send('styles', { selector: p.selector, styles: el ? computedStyles(el) : {}, html: el ? el.outerHTML.slice(0, 600) : '' });
        break;
      }
      case 'getListeners': send('listeners', { items: listeners }); break;
      case 'getStorage': send('storage-all', { local: ls._d, session: ss._d, cookies: safeCookies() }); break;
      case 'getNetwork': send('network-all', { items: network }); break;
      case 'getPerf': {
        perf.load = Math.round(performance.now() - perf.start);
        perf.resources = performance.getEntriesByType('resource').slice(0, 50).map(function (r) { return { name: r.name, size: r.transferSize || 0, duration: Math.round(r.duration) }; });
        send('perf', perf); break;
      }
      case 'getTrace': send('trace', { items: trace.slice(-500) }); break;
      case 'getFormState': send('form-state', formState()); break;
      case 'setInspect': cfg.inspect = !!p.value; if (cfg.inspect) document.body.style.cursor = 'crosshair'; else document.body.style.cursor = ''; break;
      case 'clearTrace': trace.length = 0; break;
      case 'setScheme': cfg.scheme = p.value; document.documentElement.dataset.scheme = p.value; break;
      case 'setMotion': cfg.motion = p.value; break;
      case 'setLocale': document.documentElement.lang = p.value; document.documentElement.dir = p.value === 'ar' ? 'rtl' : 'ltr'; break;
      case 'speech': {
        try {
          var text = [].map.call(document.querySelectorAll('h1,h2,h3,p,a,button,label'), function (x) { return x.textContent.trim(); }).filter(Boolean).join('. ');
          speechSynthesis.cancel(); var u = new SpeechSynthesisUtterance(text.slice(0, 900)); u.lang = p.lang || 'ru-RU'; speechSynthesis.speak(u);
          send('alert', { text: 'Скринридер читает страницу', level: 'info' });
        } catch (e3) { send('alert', { text: 'speechSynthesis недоступен', level: 'warn' }); }
        break;
      }
      case 'a11yScan': {
        var issues = [];
        document.querySelectorAll('img:not([alt])').forEach(function (x) { issues.push('img без alt: ' + x.src.slice(0, 60)); });
        document.querySelectorAll('button:empty, a:empty').forEach(function (x) { issues.push('пустая кнопка/ссылка'); });
        document.querySelectorAll('[tabindex]').forEach(function (x) { if (+x.tabIndex > 0) issues.push('tabindex=' + x.tabIndex + ' ломает порядок фокуса'); });
        var focusables = document.querySelectorAll('a[href],button,input,select,textarea,[tabindex="0"]');
        send('a11y', { issues: issues, focusables: focusables.length, headings: document.querySelectorAll('h1,h2,h3,h4,h5,h6').length, lang: document.documentElement.lang });
        break;
      }
    }
  });
  function safeCookies() {
    try { return document.cookie; } catch (e) { return '(изолировано sandbox)'; }
  }

  /* ── boot ─────────────────────────────────────────────────────── */
  function onReady() {
    document.documentElement.lang = cfg.locale || 'ru';
    if (cfg.locale === 'ar') document.documentElement.dir = 'rtl';
    if (cfg.scheme && cfg.scheme !== 'auto') document.documentElement.dataset.scheme = cfg.scheme;
    if (cfg.formState) restoreForm(cfg.formState);
    send('ready', { ms: Math.round(performance.now() - perf.start), title: document.title,
                    elements: document.querySelectorAll('*').length, scripts: document.scripts.length });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', onReady);
  else onReady();
  window.addEventListener('load', function () {
    perf.load = Math.round(performance.now() - perf.start);
    send('perf', perf);
  });
}

export function bridgeSource() {
  return '(' + bridgeMain.toString() + ')();';
}
