/* Toolbelt: colours, generators, converters, JSON/assets, automation. */
import * as acorn from 'acorn';
import { state, ctx, esc, toast, download, copy, $, sanitizeColor } from './core.js';
import { read, write, exists, listFiles, mimeOf, projectJSON } from './state.js';
import { insertText, getDoc, setDoc, getSelection, replaceSelection } from './editor.js';
import { CDN_LIBS } from './data.js';

/* ── colour maths ───────────────────────────────────────────────── */
export function hexToRgb(hex) {
  let h = String(hex || '').replace('#', '').trim();
  if (/^[0-9a-f]{3,4}$/i.test(h)) h = h.split('').slice(0, 3).map(c => c + c).join('');
  if (!/^[0-9a-f]{6}$/i.test(h)) return null;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
export function rgbToHex(r, g, b) { return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join(''); }
export function hexToHsl(hex) {
  const c = hexToRgb(hex); if (!c) return null;
  let [r, g, b] = c.map(v => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > .5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
  }
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}
export function hslToRgb(h, s, l) {
  s /= 100; l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0]; else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x]; else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c]; else [r, g, b] = [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255].map(Math.round);
}
export function hslToHex(h, s, l) { return rgbToHex(...hslToRgb(h, s, l)); }
export function hexToOklch(hex) {
  const rgb = hexToRgb(hex); if (!rgb) return null;
  const lin = rgb.map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; });
  const l = Math.cbrt(.4122214708 * lin[0] + .5363325363 * lin[1] + .0514459929 * lin[2]);
  const m = Math.cbrt(.2119034982 * lin[0] + .6806995451 * lin[1] + .1073969566 * lin[2]);
  const s = Math.cbrt(.0883024619 * lin[0] + .2817188376 * lin[1] + .6299787005 * lin[2]);
  const L = .2104542553 * l + .793617785 * m - .0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + .4505937099 * s;
  const b = .0259040371 * l + .7827717662 * m - .808675766 * s;
  const C = Math.sqrt(a * a + b * b), H = (Math.atan2(b, a) * 180 / Math.PI + 360) % 360;
  return `oklch(${(L * 100).toFixed(1)}% ${C.toFixed(3)} ${H.toFixed(1)})`;
}
export function luminance(hex) {
  const c = hexToRgb(hex); if (!c) return 0;
  const [r, g, b] = c.map(v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; });
  return .2126 * r + .7152 * g + .0722 * b;
}
export function contrast(a, b) {
  const l1 = luminance(a), l2 = luminance(b);
  return ((Math.max(l1, l2) + .05) / (Math.min(l1, l2) + .05));
}
export function contrastVerdict(ratio, big = false) {
  if (ratio >= 7) return 'AAA ';
  if (ratio >= (big ? 3 : 4.5)) return 'AA ';
  if (ratio >= 3) return 'только крупный текст ';
  return 'не проходит ';
}
export function paletteFrom(hex, count = 6) {
  const hsl = hexToHsl(hex) || { h: 260, s: 70, l: 55 };
  const out = [];
  for (let i = 0; i < count; i++) {
    const l = Math.max(12, Math.min(94, 18 + (i / Math.max(1, count - 1)) * 74));
    const h = (hsl.h + i * 12) % 360;
    out.push(hslToHex(h, Math.max(20, hsl.s - i * 3), l));
  }
  return out;
}
export function complementary(hex) { const h = hexToHsl(hex); return h ? hslToHex((h.h + 180) % 360, h.s, h.l) : '#ffffff'; }
export function randomColor() { return '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0'); }
export function convertColor(input) {
  const v = String(input).trim();
  let hex = v;
  const rgbM = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(v);
  const hslM = /^hsla?\(\s*([\d.]+)[,\s]+([\d.]+)%[,\s]+([\d.]+)%/i.exec(v);
  if (rgbM) hex = rgbToHex(+rgbM[1], +rgbM[2], +rgbM[3]);
  else if (hslM) hex = hslToHex(+hslM[1], +hslM[2], +hslM[3]);
  const rgb = hexToRgb(hex), hsl = hexToHsl(hex);
  return hex && rgb ? {
    hex, rgb: `rgb(${rgb.join(', ')})`, hsl: `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)`,
    oklch: hexToOklch(hex), lum: luminance(hex).toFixed(3),
    contrastWhite: contrast(hex, '#ffffff').toFixed(2), contrastBlack: contrast(hex, '#000000').toFixed(2)
  } : null;
}

/* ── CSS generators ─────────────────────────────────────────────── */
export const generators = {
  gradient: (a = '#7c6cf6', b = '#b06cf6', angle = 135, type = 'linear') =>
    type === 'radial' ? `background: radial-gradient(circle at 30% 30%, ${a}, ${b});` : `background: linear-gradient(${angle}deg, ${a}, ${b});`,
  boxShadow: (x = 0, y = 12, blur = 30, spread = 0, color = '#000000', alpha = .25, inset = false) =>
    `box-shadow: ${inset ? 'inset ' : ''}${x}px ${y}px ${blur}px ${spread}px ${color}${Math.round(alpha * 255).toString(16).padStart(2, '0')};`,
  textShadow: (x = 0, y = 2, blur = 8, color = '#00000066') => `text-shadow: ${x}px ${y}px ${blur}px ${color};`,
  radius: (tl = 18, tr = tl, br = tl, bl = tl) => `border-radius: ${tl}px ${tr}px ${br}px ${bl}px;`,
  transform: (scale = 1, rotate = 0, tx = 0, ty = 0, skew = 0) => `transform: translate(${tx}px, ${ty}px) rotate(${rotate}deg) scale(${scale}) skew(${skew}deg);`,
  transition: (prop = 'all', dur = .3, ease = 'ease', delay = 0) => `transition: ${prop} ${dur}s ${ease} ${delay}s;`,
  animation: (name = 'pop', dur = .6, iter = 1, ease = 'ease-out') =>
    `animation: ${name} ${dur}s ${ease} ${iter};\n\n@keyframes ${name} {\n  from { opacity: 0; transform: translateY(16px) scale(.96); }\n  to { opacity: 1; transform: none; }\n}`,
  filter: (blur = 0, brightness = 100, saturate = 100, grayscale = 0, hue = 0) =>
    `filter: blur(${blur}px) brightness(${brightness}%) saturate(${saturate}%) grayscale(${grayscale}%) hue-rotate(${hue}deg);`,
  backdrop: (blur = 12, saturate = 140) => `backdrop-filter: blur(${blur}px) saturate(${saturate}%);`,
  clipPath: (shape = 'circle', v = 50) => {
    const map = {
      circle: `circle(${v}% at 50% 50%)`, ellipse: `ellipse(${v}% ${Math.round(v * .7)}% at 50% 50%)`,
      polygon: `polygon(50% 0%, 100% 38%, 82% 100%, 18% 100%, 0% 38%)`,
      inset: `inset(${v / 6}% round 24px)`, triangle: 'polygon(50% 0, 100% 100%, 0 100%)'
    };
    return `clip-path: ${map[shape] || map.circle};`;
  },
  grid: (cols = 3, gap = 16) => `display: grid;\ngrid-template-columns: repeat(${cols}, minmax(0, 1fr));\ngap: ${gap}px;`,
  flex: (dir = 'row', justify = 'center', align = 'center', gap = 12, wrap = 'wrap') =>
    `display: flex;\nflex-direction: ${dir};\njustify-content: ${justify};\nalign-items: ${align};\nflex-wrap: ${wrap};\ngap: ${gap}px;`,
  fontFace: (name = 'MyFont', path = 'fonts/myfont.woff2') =>
    `@font-face {\n  font-family: '${name}';\n  src: url('${path}') format('woff2');\n  font-weight: 400 800;\n  font-display: swap;\n}`,
  variables: (base = '#7c6cf6') => {
    const p = paletteFrom(base, 5);
    return `:root {\n${p.map((c, i) => `  --color-${i + 1}: ${c};`).join('\n')}\n  --radius: 20px;\n  --shadow: 0 12px 30px ${base}33;\n}`;
  },
  autoprefix: (code) => {
    const pairs = [['backdrop-filter', '-webkit-backdrop-filter'], ['user-select', '-webkit-user-select'],
                   ['appearance', '-webkit-appearance'], ['clip-path', '-webkit-clip-path'],
                   ['mask', '-webkit-mask'], ['display: flex', 'display: -webkit-box']];
    let out = code;
    for (const [prop, pref] of pairs) {
      const re = new RegExp('(^|\\n)(\\s*)' + prop.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\s*):', 'g');
      out = out.replace(re, (m, a, b, c) => `${a}${b}${pref}${c}:\n${b}${prop}${c}:`);
    }
    return out;
  }
};
export function specificity(sel) {
  const ids = (sel.match(/#[\w-]+/g) || []).length;
  const cls = (sel.match(/\.[\w-]+|\[[^\]]+\]|:[\w-]+/g) || []).length;
  const els = (sel.replace(/[.#][\w-]+|\[[^\]]+\]|:[^ ,>+~]+/g, '').match(/[a-zA-Z][\w-]*/g) || []).length;
  return { ids, cls, els, score: ids * 100 + cls * 10 + els, text: `(${ids}, ${cls}, ${els})` };
}
export function unitConvert(value, from, to, base = 16) {
  const n = parseFloat(value); if (isNaN(n)) return value;
  const px = from === 'px' ? n : from === 'rem' || from === 'em' ? n * base : from === '%' ? n * base / 100 : n;
  const out = to === 'px' ? px : to === 'rem' || to === 'em' ? px / base : to === '%' ? px / base * 100 : px;
  return `${Math.round(out * 1000) / 1000}${to}`;
}
export function expandShorthand(decl) {
  const [prop, ...rest] = decl.split(':'); const v = rest.join(':').trim();
  const parts = v.split(/\s+/);
  if (prop === 'margin' || prop === 'padding') {
    const [t = '0', r = t, b = t, l = r] = parts;
    return `${prop}-top: ${t};\n${prop}-right: ${r};\n${prop}-bottom: ${b};\n${prop}-left: ${l};`;
  }
  if (prop === 'border') return `border-width: ${parts[0] || '1px'};\nborder-style: ${parts[1] || 'solid'};\nborder-color: ${parts[2] || 'currentColor'};`;
  if (prop === 'border-radius') {
    const [tl = '0', tr = tl, br = tl, bl = tr] = parts;
    return `border-top-left-radius: ${tl};\nborder-top-right-radius: ${tr};\nborder-bottom-right-radius: ${br};\nborder-bottom-left-radius: ${bl};`;
  }
  if (prop === 'background') return `background-color: ${parts.find(p => /^(#|rgb|hsl|[a-z]+$)/i.test(p)) || 'transparent'};`;
  return decl;
}
export function collapseShorthand(code) {
  return code.replace(/(margin|padding)-top:\s*([^;]+);\s*\1-right:\s*([^;]+);\s*\1-bottom:\s*([^;]+);\s*\1-left:\s*([^;]+);/g,
    (m, p, t, r, b, l) => `${p}: ${t} ${r} ${b} ${l};`);
}
export function extractCssFromHtml() {
  const html = read(state.entry);
  const styles = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map(m => m[1]).join('\n');
  if (!styles) { toast('Встроенных <style> не найдено', 'warn'); return ''; }
  const path = 'extracted.css';
  write(path, styles.trim());
  toast(`Извлечено ${styles.length} символов в ${path}`, 'ok', 'CSS');
  return styles;
}
export function darkThemeFrom(css) {
  return css.replace(/#(?:[0-9a-f]{3}|[0-9a-f]{6})\b/gi, m => {
    const h = hexToHsl(m); if (!h) return m;
    return hslToHex(h.h, Math.max(10, h.s - 10), 100 - h.l);
  });
}

/* ── JSON / code utilities ───────────────────────────────────────── */
export function formatJSON(code) {
  try { return JSON.stringify(JSON.parse(code), null, state.settings.tabSize || 2); }
  catch (e) { toast('JSON невалиден: ' + e.message, 'err'); return code; }
}
export function validateJSON(code) {
  try { const v = JSON.parse(code); return { ok: true, value: v, message: `Валидный JSON: ${Object.keys(v).length} ключей верхнего уровня` }; }
  catch (e) { return { ok: false, message: e.message }; }
}
export function jsonToJS(code) {
  try { const v = JSON.parse(code); return 'const data = ' + JSON.stringify(v, null, 2).replace(/"([^"]+)":/g, (m, k) => /^[A-Za-z_$][\w$]*$/.test(k) ? k + ':' : m) + ';'; }
  catch (e) { toast('JSON невалиден', 'err'); return code; }
}
export function visualizeJSON(code) {
  try {
    const v = JSON.parse(code);
    const lines = [];
    const walk = (o, path = 'root') => {
      if (o && typeof o === 'object') {
        lines.push(`${path} ${Array.isArray(o) ? `[Array ${o.length}]` : `{Object ${Object.keys(o).length}}`}`);
        for (const [k, val] of Object.entries(o).slice(0, 20)) walk(val, path + '.' + k);
      } else lines.push(`${path} = ${JSON.stringify(o)}`);
    };
    walk(v);
    return lines.join('\n');
  } catch (e) { return 'Ошибка: ' + e.message; }
}
export function generateMockData(count = 5) {
  const names = ['Анна', 'Борис', 'Виктория', 'Глеб', 'Дарья', 'Егор'];
  return JSON.stringify(Array.from({ length: count }, (_, i) => ({
    id: i + 1, name: names[i % names.length],
    email: `user${i + 1}@example.com`,
    age: 18 + Math.floor(Math.random() * 45),
    active: Math.random() > .4,
    color: randomColor()
  })), null, 2);
}
export function uuid() { return crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }); }
export function generateTests(code) {
  const fns = [...code.matchAll(/(?:function\s+([\w$]+)|const\s+([\w$]+)\s*=\s*\([^)]*\)\s*=>)/g)].map(m => m[1] || m[2]);
  if (!fns.length) return `// Функции не найдены. Пример теста:\nfunction assert(c, m) { if (!c) throw new Error(' ' + m); console.log(' ' + m); }\nassert(1 + 1 === 2, 'сложение');`;
  return `// Автотесты для: ${fns.join(', ')}\nfunction assert(condition, message) {\n  if (!condition) throw new Error(' ' + message);\n  console.log(' ' + message);\n}\n\n` +
    fns.map(f => `assert(typeof ${f} === 'function', '${f} — функция');\n// TODO: проверьте результат ${f}(...)`).join('\n\n');
}
export function generateDocs(code) {
  const fns = [...code.matchAll(/(?:function\s+([\w$]+)\s*\(([^)]*)\)|const\s+([\w$]+)\s*=\s*\(([^)]*)\)\s*=>)/g)];
  const rows = fns.map(m => ({
    name: m[1] || m[3], params: (m[2] || m[4] || '').split(',').map(s => s.trim()).filter(Boolean)
  }));
  return `# Документация\n\nСгенерировано Runlet из JSDoc-подобного анализа.\n\n` +
    (rows.length ? rows.map(r => `## \`${r.name}(${r.params.join(', ')})\`\n\n| Параметр | Описание |\n| --- | --- |\n${r.params.map(p => `| \`${p}\` | TODO |`).join('\n') || '| — | — |'}\n\n**Возвращает:** TODO\n`).join('\n') : 'Функций не найдено.\n');
}
export function generateReadme() {
  const r = state.report;
  return `# ${state.projectName}\n\n> ${r?.summary?.headline || 'Проект на HTML, CSS и JavaScript'}\n\n` +
    `## Что делает\n\n${r?.summary?.description || 'Описание появится после анализа кода.'}\n\n` +
    `## Запуск\n\nОткройте \`index.html\` в браузере или запустите проект в Runlet.\n\n` +
    `## Структура\n\n${listFiles().map(f => '- `' + f + '`').join('\n')}\n\n` +
    (state.deps.length ? `## Зависимости\n\n${state.deps.map(d => '- ' + (typeof d === 'string' ? d : d.name || d.id)).join('\n')}\n\n` : '') +
    `---\nСгенерировано Runlet.\n`;
}
export function generateChangelog() {
  return `# Changelog\n\n## [1.0.0] — ${new Date().toISOString().slice(0, 10)}\n\n### Добавлено\n` +
    state.snapshots.slice(0, 8).map(s => `- ${s.label} (${new Date(s.at).toLocaleString('ru-RU')})`).join('\n') +
    `\n\n### Файлы\n${listFiles().map(f => `- \`${f}\``).join('\n')}\n`;
}
export function generateSEO() {
  const title = esc(String(state.projectName || 'Моя страница').slice(0, 120));
  return `<!-- SEO -->\n<meta name="description" content="${title} — описание страницы">\n` +
    `<meta name="keywords" content="runlet, html, css, javascript">\n` +
    `<meta name="author" content="Runlet">\n<link rel="canonical" href="https://example.com/">\n\n` +
    `<!-- Open Graph -->\n<meta property="og:type" content="website">\n` +
    `<meta property="og:title" content="${title}">\n` +
    `<meta property="og:description" content="${title} — описание страницы">\n` +
    `<meta property="og:image" content="https://example.com/cover.png">\n` +
    `<meta name="twitter:card" content="summary_large_image">\n\n` +
    `<!-- Schema.org -->\n<script type="application/ld+json">\n${JSON.stringify({ '@context': 'https://schema.org', '@type': 'WebSite', name: String(state.projectName || '').slice(0, 120), url: 'https://example.com/' }, null, 2).replace(/</g, '\\u003c')}\n</script>`;
}
export function generateAltFor(path) {
  const name = String(path).split('/').pop().replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
  // alt is injected into an HTML attribute — strip anything quote/angle-like.
  const clean = name.replace(/[^\p{L}\p{N} _-]/gu, '').slice(0, 100).trim();
  return (clean.charAt(0).toUpperCase() + clean.slice(1)) || 'Изображение';
}
export function accessibleWrap(html) {
  return html.replace(/<img\b([^>]*?)>/gi, (m, a) => /alt=/.test(a) ? m : `<img${a} alt="${generateAltFor((/src=["']([^"']+)/.exec(a) || [])[1] || 'image')}">`)
    .replace(/<button\b([^>]*)>\s*<\/button>/gi, (m, a) => `<button${a} aria-label="Кнопка"></button>`)
    .replace(/<a\b([^>]*?)>\s*<\/a>/gi, (m, a) => `<a${a}>Подробнее</a>`);
}
export function securityScan(code) {
  const findings = [];
  const rules = [
    [/\beval\s*\(|new\s+Function\s*\(/g, 'eval / new Function — выполнение строки как кода', 'high'],
    [/\.innerHTML\s*=/g, 'innerHTML — потенциальный XSS', 'medium'],
    [/document\.write\s*\(/g, 'document.write — устаревший и опасный метод', 'medium'],
    [/\bon\w+\s*=/g, 'инлайн-обработчик событий', 'low'],
    [/https?:\/\/[^\s"']+/g, 'внешний ресурс — проверьте его доверие', 'info'],
    [/localStorage\.setItem\s*\([^,]+,\s*(?!JSON)/g, 'в localStorage пишется не JSON — проверьте тип', 'low'],
    [/password|token|secret|api[_-]?key/gi, 'похоже на секрет в коде — не публикуйте его', 'high'],
    [/javascript\s*:/gi, 'javascript: URL — классический XSS-вектор', 'high'],
    [/data:text\/html/gi, 'data:text/html может выполнить произвольный код', 'high'],
    [/setTimeout\s*\(\s*['"]/g, 'setTimeout со строкой — неявный eval', 'high'],
    [/postMessage\s*\([^,]+,\s*['"]\*['"]/g, 'postMessage с targetOrigin=* — утечка данных другому окну', 'medium'],
    [/target\s*=\s*['"]_blank['"](?![^>]*noopener)/gi, 'target=_blank без rel=noopener — tabnabbing', 'medium'],
    [/\bsrcdoc\s*=/gi, 'srcdoc с пользовательскими данными — проверьте изоляцию iframe', 'medium'],
    [/document\.cookie/gi, 'чтение document.cookie — проверьте, что там нет токенов', 'low'],
    [/\bwindow\.open\s*\(/g, 'window.open — возможен фишинг через новое окно', 'low'],
    [/\blocalStorage\s*\.\s*setItem\s*\([^,]+,\s*[^)]*password/gi, 'пароль в localStorage — доступен любому скрипту страницы', 'high']
  ];
  for (const [re, msg, sev] of rules) {
    const hits = [...code.matchAll(re)];
    if (hits.length) findings.push({ sev, msg, count: hits.length, line: code.slice(0, hits[0].index).split('\n').length });
  }
  return findings;
}
export function unusedAssets() {
  const all = Object.values(state.files).map(f => f.content).join('\n');
  return listFiles().filter(p => /\.(png|jpe?g|gif|webp|svg|woff2?|mp3|mp4|webm)$/i.test(p))
    .filter(p => !all.includes(p) && !all.includes(p.split('/').pop()));
}
export function perfTips() {
  const css = Object.entries(state.files).filter(([p]) => /\.css$/i.test(p)).map(([, f]) => f.content).join('\n');
  const html = read(state.entry);
  const js = Object.entries(state.files).filter(([p]) => /\.js$/i.test(p)).map(([, f]) => f.content).join('\n');
  const tips = [];
  if (/@import/.test(css)) tips.push('Замените @import на <link> — @import создаёт цепочку запросов.');
  const imgs = [...html.matchAll(/<img\b[^>]*>/gi)].map(m => m[0]);
  if (imgs.filter(t => !/loading=/.test(t)).length) tips.push(`Добавьте loading="lazy" к ${imgs.filter(t => !/loading=/.test(t)).length} картинкам.`);
  if (!/rel=["']preload/.test(html)) tips.push('Добавьте <link rel="preload"> для критичного CSS/шрифта.');
  if (/transition:\s*all/.test(css)) tips.push('transition: all анимирует лишнее — укажите конкретные свойства.');
  if (/document\.querySelector/.test(js) && /for\s*\(|while\s*\(|setInterval/.test(js)) tips.push('Похоже, DOM-запрос внутри цикла — кэшируйте элемент.');
  if (!html.includes('<main') && /<div/.test(html)) tips.push('Используйте <main> и другие семантические теги.');
  tips.push('Минифицируйте CSS/JS перед публикацией (команда «Минифицировать»).');
  return tips;
}

/** Arithmetic-only evaluator: NO access to globals, NO Function/eval. */
export function safeCalc(expr) {
  if (typeof expr !== 'string' || expr.length > 200) throw new Error('Выражение слишком длинное');
  const ast = acorn.parseExpressionAt(expr, 0, { ecmaVersion: 'latest' });
  if (ast.end !== expr.trim().length) throw new Error('Лишние символы после выражения');
  const binary = {
    '+': (a, b) => a + b, '-': (a, b) => a - b, '*': (a, b) => a * b,
    '/': (a, b) => a / b, '%': (a, b) => a % b, '**': (a, b) => a ** b
  };
  const unary = { '+': a => +a, '-': a => -a };
  const mathFns = {
    abs: Math.abs, floor: Math.floor, ceil: Math.ceil, round: Math.round,
    sqrt: Math.sqrt, pow: Math.pow, min: Math.min, max: Math.max,
    sin: Math.sin, cos: Math.cos, tan: Math.tan, log: Math.log, exp: Math.exp,
    trunc: Math.trunc, sign: Math.sign, cbrt: Math.cbrt
  };
  const mathConsts = { PI: Math.PI, E: Math.E, LN2: Math.LN2, LN10: Math.LN10, SQRT2: Math.SQRT2 };
  function ev(n, depth) {
    if (depth > 30) throw new Error('Слишком глубокое выражение');
    switch (n.type) {
      case 'Literal':
        if (typeof n.value !== 'number' || !Number.isFinite(n.value)) throw new Error('Разрешены только числа');
        return n.value;
      case 'ParenthesizedExpression': return ev(n.expression, depth + 1);
      case 'UnaryExpression': {
        const f = unary[n.operator];
        if (!f || n.prefix !== true) throw new Error('Недопустимый унарный оператор');
        return f(ev(n.argument, depth + 1));
      }
      case 'BinaryExpression': {
        const f = binary[n.operator];
        if (!f) throw new Error('Недопустимый оператор');
        const v = f(ev(n.left, depth + 1), ev(n.right, depth + 1));
        if (!Number.isFinite(v)) throw new Error('Результат не число');
        return v;
      }
      case 'MemberExpression':
        if (n.object.type === 'Identifier' && n.object.name === 'Math' &&
            !n.computed && n.property.type === 'Identifier' &&
            Object.prototype.hasOwnProperty.call(mathConsts, n.property.name)) return mathConsts[n.property.name];
        throw new Error('Доступ к объектам запрещён');
      case 'CallExpression':
        if (n.callee.type === 'MemberExpression' && n.callee.object.type === 'Identifier' &&
            n.callee.object.name === 'Math' && !n.callee.computed &&
            n.callee.property.type === 'Identifier' &&
            Object.prototype.hasOwnProperty.call(mathFns, n.callee.property.name) &&
            n.arguments.length <= 4 && n.arguments.every(a => a.type !== 'SpreadElement')) {
          const args = n.arguments.map(a => ev(a, depth + 1));
          const v = mathFns[n.callee.property.name](...args);
          if (!Number.isFinite(v)) throw new Error('Результат не число');
          return v;
        }
        throw new Error('Вызовы функций запрещены');
      default: throw new Error('Недопустимый элемент выражения');
    }
  }
  return ev(ast, 0);
}

/* ── assets (canvas) ────────────────────────────────────────────── */
export async function processImage(src, { width = null, height = null, format = 'image/png', quality = .85 } = {}) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const w = width || img.width, h = height || Math.round(img.height * (w / img.width));
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve(c.toDataURL(format, quality));
    };
    img.onerror = () => reject(new Error('Не удалось загрузить изображение'));
    img.src = src;
  });
}
export function placeholderImage(w = 640, h = 360, color = '#7c6cf6', text = `${w}×${h}`) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, color); g.addColorStop(1, complementary(color));
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.font = `bold ${Math.round(Math.min(w, h) / 7)}px sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h / 2);
  return c.toDataURL('image/png');
}
export function optimizeSvg(svg) {
  return svg.replace(/<!--[\s\S]*?-->/g, '').replace(/\s{2,}/g, ' ').replace(/>\s+</g, '><').replace(/\s+\/>/g, '/>').trim();
}
export function faviconFrom(color = '#7c6cf6') {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d');
  x.fillStyle = color; x.beginPath(); x.roundRect(0, 0, 64, 64, 16); x.fill();
  x.fillStyle = '#fff'; x.font = 'bold 40px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText('R', 32, 34);
  return c.toDataURL('image/png');
}
export const SVG_ICONS = {
  heart: '<svg viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M12 21s-8-4.9-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 6.1-8 11-8 11Z"/></svg>',
  star: '<svg viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="m12 2 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1Z"/></svg>',
  check: '<svg viewBox="0 0 24 24" width="24" height="24"><path fill="none" stroke="currentColor" stroke-width="3" d="m4 12 5 5L20 6"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M4 11h12l-5-5 1.5-1.5L20 12l-7.5 7.5L11 18l5-5H4Z"/></svg>',
  search: '<svg viewBox="0 0 24 24" width="24" height="24"><circle cx="10" cy="10" r="6" fill="none" stroke="currentColor" stroke-width="2"/><path d="m15 15 6 6" stroke="currentColor" stroke-width="2"/></svg>',
  home: '<svg viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M12 3 2 11h3v9h6v-6h2v6h6v-9h3Z"/></svg>',
  user: '<svg viewBox="0 0 24 24" width="24" height="24"><circle cx="12" cy="8" r="4" fill="currentColor"/><path fill="currentColor" d="M4 21c0-4 3.5-7 8-7s8 3 8 7Z"/></svg>',
  code: '<svg viewBox="0 0 24 24" width="24" height="24"><path fill="none" stroke="currentColor" stroke-width="2" d="m8 6-6 6 6 6m8-12 6 6-6 6m-2-14-4 16"/></svg>'
};

/* ── exports / integrations ─────────────────────────────────────── */
export function workflowYAML(kind = 'github') {
  const body = `name: Runlet build
on: [push, pull_request]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - run: node cli/runlet.mjs analyze index.html
      - run: node cli/runlet.mjs build -o dist/index.html
`;
  return kind === 'gitlab' ? body.replace('runs-on: ubuntu-latest', 'image: node:20').replace('uses: actions/checkout@v4', 'script: echo checkout') : body;
}
export function embedCode(opts = {}) {
  const id = encodeURIComponent(String(state.projectName).slice(0, 100));
  const theme = ['dark', 'light', 'contrast'].includes(opts.theme) ? opts.theme : 'dark';
  const height = Math.max(120, Math.min(4000, Math.round(Number(opts.height) || 520)));
  const params = new URLSearchParams({ theme, run: opts.run !== false ? '1' : '0', v: '1' });
  return `<iframe src="https://runlet.app/embed/${id}?${params}" width="100%" height="${height}"\n  style="border:0;border-radius:20px;overflow:hidden"\n  loading="lazy" referrerpolicy="no-referrer" title="${esc(String(state.projectName).slice(0, 100))}" sandbox="allow-scripts allow-forms"></iframe>`;
}
export function staticSite() {
  const html = read(state.entry);
  const css = Object.entries(state.files).filter(([p]) => /\.css$/i.test(p)).map(([, f]) => `<style>\n${f.content}\n</style>`).join('\n');
  const js = Object.entries(state.files).filter(([p]) => /\.js$/i.test(p)).map(([, f]) => `<script>\n${f.content}\n</script>`).join('\n');
  return { 'index.html': html.replace('</head>', css + '\n</head>').replace('</body>', js + '\n</body>'),
           'README.md': generateReadme(), '.github/workflows/build.yml': workflowYAML('github') };
}
export function refactorSelection(code) {
  return code.replace(/\bvar\s+/g, 'let ')
    .replace(/([^=!<>])==([^=])/g, '$1===$2')
    .replace(/([^!])!=([^=])/g, '$1!==$2')
    .replace(/'\s*\+\s*([A-Za-z_$][\w$]*)\s*\+\s*'/g, '${$1}');
}
