/* Local (offline) code assistant: explains, generates, fixes, documents. */
import { state, ctx, $, el, esc, on, emit, toast, copy, download } from './core.js';
import { read, write, listFiles, allTextFiles } from './state.js';
import { getSelection, insertText, setDoc, getDoc, replaceSelection, goto } from './editor.js';
import { reportMarkdown, applyFix, fixAllSafe, runAnalysis } from './analyzer.js';
import { LESSONS, SNIPPETS, RECIPES } from './data.js';
import {
  generateTests, generateDocs, generateReadme, generateChangelog, generateSEO,
  generateAltFor, accessibleWrap, securityScan, perfTips, refactorSelection,
  paletteFrom, convertColor, randomColor, generateMockData
} from './tools.js';

const messages = [];

export function initAssistant() {
  const host = $('#assistantPanel'); if (!host) return;
  host.innerHTML = `<div class="insp-toolbar"><span class="pill pill-accent">✦ локальный ассистент</span>
      <span class="spacer"></span><button class="mini-btn" id="aiClear">Очистить</button></div>
    <div class="chat" id="aiChat"></div>
    <div class="quick-prompts" id="aiQuick"></div>
    <div class="repl-bar"><span class="repl-prompt">✦</span><input id="aiInput" placeholder="Спросите: «что делает код?», «исправь ошибки»…">
      <button class="mini-btn" id="aiSend">➤</button></div>`;
  const quick = ['Что делает код?', 'Объясни как новичку', 'Найди ошибки', 'Исправь всё',
    'Сделай карточку', 'Сгенерируй тесты', 'SEO-метатеги', 'Проверь безопасность'];
  const qp = host.querySelector('#aiQuick');
  for (const q of quick) {
    const b = el('button', { class: 'mini-btn', text: q, onclick: () => { host.querySelector('#aiInput').value = q; ask(q); } });
    qp.appendChild(b);
  }
  const input = host.querySelector('#aiInput');
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); ask(input.value); input.value = ''; } });
  host.querySelector('#aiSend').onclick = () => { ask(input.value); input.value = ''; };
  host.querySelector('#aiClear').onclick = () => { messages.length = 0; render(); };
  push('bot', 'Привет! Я локальный ассистент Runlet 🐍. Умею объяснять код по отчёту Python-движка, искать ошибки, генерировать разметку, тесты, документацию и SEO. Всё работает офлайн, без ключей API.');
  render();
}

function push(who, text, code = '', actions = []) {
  messages.push({ who, text, code, actions });
  render();
}
function render() {
  const chat = $('#aiChat'); if (!chat) return;
  chat.innerHTML = messages.map((m, i) => `<div class="msg ${m.who}">
    ${esc(m.text)}${m.code ? `<pre>${esc(m.code)}</pre>` : ''}
    ${m.code ? `<div class="msg-actions"><button class="mini-btn" data-ai-insert="${i}">Вставить</button>
      <button class="mini-btn" data-ai-copy="${i}">Копировать</button>
      <button class="mini-btn" data-ai-file="${i}">В файл</button></div>` : ''}
    ${(m.actions || []).map((a, j) => `<button class="mini-btn" data-ai-action="${i}:${j}">${esc(a.label)}</button>`).join('')}
    </div>`).join('');
  chat.scrollTop = chat.scrollHeight;
  chat.querySelectorAll('[data-ai-insert]').forEach(b => b.onclick = () => insertText(messages[+b.dataset.aiInsert].code));
  chat.querySelectorAll('[data-ai-copy]').forEach(b => b.onclick = () => { copy(messages[+b.dataset.aiCopy].code); toast('Скопировано', 'ok'); });
  chat.querySelectorAll('[data-ai-file]').forEach(b => b.onclick = () => {
    const code = messages[+b.dataset.aiFile].code;
    const ext = /<[a-z]+|<!doctype/i.test(code) ? 'html' : /[{};]\s*(\.|-?\w+:)/.test(code) && !/\bfunction\b|\bconst\b/.test(code) ? 'css' : 'js';
    const p = `generated/${Date.now().toString(36)}.${ext}`;
    write(p, code); emit('files:changed', { path: p }); toast('Создан ' + p, 'ok');
  });
  chat.querySelectorAll('[data-ai-action]').forEach(b => b.onclick = () => {
    const [i, j] = b.dataset.aiAction.split(':').map(Number);
    messages[i].actions[j]?.run?.();
  });
}

export function ask(question) {
  const q = String(question || '').trim();
  if (!q) return;
  push('user', q);
  const low = q.toLowerCase();
  const r = state.report;
  const code = allTextFiles();
  const joined = Object.values(code).join('\n').slice(0, 60000);
  setTimeout(() => respond(low, q, r, joined), 120);
}

function respond(low, q, r, joined) {
  if (/привет|здравств|help|помощь|что умеешь/.test(low)) {
    push('bot', 'Я анализирую проект локально. Попробуйте: «что делает код?», «объясни выделенное», «найди ошибки», «исправь всё», «сделай форму», «сгенерируй тесты», «README».',
      '', [{ label: '▶ Анализ', run: () => runAnalysis() }]);
    return;
  }
  if (/исправь|почини|fix|автопочин/.test(low)) {
    const n = fixAllSafe(20);
    push('bot', `Применил ${n} безопасных автоисправлений. Ошибки уровня error лучше смотреть вручную — там часто нужна логика.`,
      '', [{ label: 'Перезапустить анализ', run: () => runAnalysis() }]);
    return;
  }
  if (/ошибк|error|проблем|слома|баг/.test(low)) {
    if (!r) { push('bot', 'Сначала запустите анализ кода —Ctrl+Shift+A.'); return; }
    const errs = r.diagnostics.filter(d => d.sev === 'error');
    const warns = r.diagnostics.filter(d => d.sev === 'warning');
    push('bot', `Нашёл ${errs.length} ошибок и ${warns.length} предупреждений. ${r.summary.verdict}.\n\nГлавное:` +
      '\n' + errs.slice(0, 6).map((d, i) => `${i + 1}. ${d.file}:${d.line} — ${d.msg}`).join('\n'),
      '', [{ label: '🛠 Исправить безопасное', run: () => fixAllSafe() }, { label: 'Полный отчёт', run: () => ctx.runCommand('analysisReport') }]);
    return;
  }
  if (/объясни|что делает|как работает|explain|новичк/.test(low)) {
    const sel = getSelection();
    if (sel && sel.length > 4) { push('bot', explainSnippet(sel, r)); return; }
    if (!r) { push('bot', 'Запустите анализ, чтобы я собрал объяснение по всему проекту.'); return; }
    const text = /новичк|простыми|как новичку/.test(low) ? r.summary.beginner.join('\n') :
      `${r.summary.headline}\n\n${r.summary.description}\n\nЧто произойдёт:\n` +
      r.summary.steps.map((s, i) => `${i + 1}. ${s.text} (${s.confidence})`).join('\n');
    push('bot', text, '', [{ label: 'Отчёт целиком', run: () => ctx.runCommand('analysisReport') }]);
    return;
  }
  if (/тест|test/.test(low)) {
    const t = generateTests(joined);
    push('bot', 'Сгенерировал каркас тестов для найденных функций. Добавьте конкретные проверки в TODO.', t);
    return;
  }
  if (/документ|jsdoc|doc/.test(low)) {
    push('bot', 'Документация по функциям проекта:', generateDocs(joined)); return;
  }
  if (/readme|описани/.test(low)) { push('bot', 'README для проекта:', generateReadme()); return; }
  if (/changelog|изменен/.test(low)) { push('bot', 'Changelog:', generateChangelog()); return; }
  if (/seo|мета|micro|schema|og:/.test(low)) { push('bot', 'Вставьте это в <head>:', generateSEO()); return; }
  if (/alt|доступн|a11y| aria/.test(low)) {
    const html = read(state.entry);
    push('bot', 'Версия с улучшенной доступностью (добавлены alt и aria-label):', accessibleWrap(html)); return;
  }
  if (/безопасн|security|xss|уязвим/.test(low)) {
    const f = securityScan(joined);
    push('bot', f.length ? `Найдено потенциальных проблем: ${f.length}\n` + f.map(x => `• [${x.sev}] ${x.msg} (строка ~${x.line})`).join('\n') : 'Явных проблем безопасности не нашёл ✅');
    return;
  }
  if (/оптимиз|производ|perf|быстр/.test(low)) {
    push('bot', 'Рекомендации:\n' + perfTips().map(t => '• ' + t).join('\n')); return;
  }
  if (/рефактор|refactor|улучши код/.test(low)) {
    const sel = getSelection() || getDoc('js');
    const out = refactorSelection(sel);
    if (out === sel) { push('bot', 'Уже выглядит неплохо: var и нестрогие сравнения не найдены.'); return; }
    push('bot', 'Предлагаю такой вариант (var→let, ==→===):', out);
    return;
  }
  if (/палитр|цвет|color/.test(low)) {
    const base = (/#([0-9a-f]{6})/i.exec(q) || [])[0] || state.settings.accent;
    const p = paletteFrom(base, 6);
    push('bot', `Палитра на основе ${base}: ${p.join(', ')}`, `:root {\n${p.map((c, i) => `  --brand-${i + 1}: ${c};`).join('\n')}\n}`);
    return;
  }
  if (/мок|данн|json|uuid|случайн/.test(low)) {
    push('bot', 'Сгенерировал мок-данные:', generateMockData(6)); return;
  }
  if (/json|форматир/.test(low)) {
    push('bot', 'Отформатированный JSON:', (() => { try { return JSON.stringify(JSON.parse(getSelection() || getDoc('js')), null, 2); } catch (e) { return 'Невалидный JSON: ' + e.message; } })());
    return;
  }
  if (/сделай|создай|сгенерируй|напиши|generate|построй|верст/.test(low)) {
    const { code, lang, note } = generateFromDescription(low);
    insertText(code, lang);
    push('bot', note, code);
    return;
  }
  if (/перевод|translate|i18n/.test(low)) {
    push('bot', 'Для интерфейса редактора переключите локаль RU/EN в настройках. Тексты страницы можно перевести через словарь:',
      `const i18n = { ru: { hello: 'Привет' }, en: { hello: 'Hello' } };\ndocument.querySelector('h1').textContent = i18n[location.hash.slice(1) || 'ru'].hello;`);
    return;
  }
  if (/анимац|animation/.test(low)) {
    push('bot', 'Плавное появление элемента:', `@keyframes reveal { from { opacity: 0; transform: translateY(18px); } to { opacity: 1; transform: none; } }\n.reveal { animation: reveal .6s cubic-bezier(.2,.8,.2,1) both; }\n@media (prefers-reduced-motion: reduce) { .reveal { animation: none; } }`);
    return;
  }
  // fallback: summarise
  if (r) push('bot', `Коротко: ${r.summary.verdict}. ${r.summary.headline}\n\n${r.summary.steps[0]?.text || ''}\n\nСпросите конкретнее: «объясни код», «найди ошибки», «сделай форму», «сгенерируй тесты».`);
  else push('bot', 'Я пока не понимаю запрос. Сначала запустите анализ кода, затем спросите «что делает код?» или «найди ошибки».');
}

function explainSnippet(sel, r) {
  const lines = sel.split('\n');
  const hits = [];
  const patterns = [
    [/querySelector|getElementById/, 'Ищет элемент на странице по селектору. Если элемент не найден — вернётся null, поэтому дальше нужна проверка.'],
    [/addEventListener/, 'Подписывается на событие: код внутри выполнится не сразу, а когда пользователь (или браузер) вызовет это событие.'],
    [/fetch|XMLHttpRequest/, 'Делает сетевой запрос. Ответ приходит асинхронно — нужен await или .then(), а ошибки надо ловить.'],
    [/localStorage|sessionStorage/, 'Сохраняет данные в браузере. Они останутся после перезагрузки страницы.'],
    [/innerHTML|textContent/, 'Меняет содержимое элемента. textContent безопаснее: он не выполняет HTML.'],
    [/console\.log/, 'Печатает значение в консоль редактора (вкладка «Консоль»).'],
    [/for\s*\(|\.forEach|\.map/, 'Перебирает коллекцию: тело выполнится по разу для каждого элемента.'],
    [/if\s*\(|\?\s*:/, 'Условный переход: одна ветка выполняется, если условие истинно.'],
    [/=>|function/, 'Объявление функции — блока кода, который можно вызвать позже.'],
    [/const|let|var/, 'Создаёт переменную — именованное место для значения.'],
    [/display\s*:|grid-template|flex/, 'CSS-правило, управляющее расположением элементов.'],
    [/#[0-9a-f]{3,8}|rgb\(|hsl\(/i, 'Цвет в CSS.'],
    [/@media/, 'Медиазапрос: стили применяются только при подходящих условиях (ширина, тема).']
  ];
  for (const [re, text] of patterns) if (re.test(sel)) hits.push(text);
  const russian = {
    querySelector: 'поиск элемента', addEventListener: 'обработчик события', fetch: 'сетевой запрос',
    innerHTML: 'замена HTML', console: 'вывод в консоль'
  };
  return `Выделено ${lines.length} строк. ${hits.length ? 'Что здесь происходит:\n' + hits.map((h, i) => `${i + 1}. ${h}`).join('\n') : 'Это фрагмент кода, который движок разберёт при следующем анализе.'}\n\n` +
    (r ? `Контекст проекта: ${r.summary.verdict}. Ошибок: ${r.metrics?.diagnostics?.error || 0}.` : 'Запустите анализ для полного контекста.');
}

export function generateFromDescription(text) {
  const t = String(text).toLowerCase();
  const g = (code, lang = 'html', note = 'Готово — вставил код в активную панель.') => ({ code, lang, note });
  if (/форму|form|логин|регистрац|вход/.test(t)) return g(SNIPPETS.find(s => s.id === 'form').code);
  if (/карточк|card|товар|продукт/.test(t)) return g(SNIPPETS.find(s => s.id === 'card').code);
  if (/кнопк|button/.test(t)) return g(`<button class="btn" type="button">Нажми меня</button>\n<style>\n.btn { border: 0; border-radius: 14px; padding: 12px 22px; font-weight: 700; color: #fff;\n  background: linear-gradient(135deg, ${state.settings.accent}, #b06cf6); cursor: pointer;\n  box-shadow: 0 8px 20px ${state.settings.accent}55; transition: transform .2s; }\n.btn:hover { transform: translateY(-2px); }\n</style>`);
  if (/модал|диалог|popup|modal/.test(t)) return g(SNIPPETS.find(s => s.id === 'modal').code);
  if (/таб|вкладк|tab/.test(t)) return g(SNIPPETS.find(s => s.id === 'tabs').code);
  if (/аккордеон|accordion|faq/.test(t)) return g(SNIPPETS.find(s => s.id === 'accordion').code);
  if (/навигац|меню|navbar|nav/.test(t)) return g(SNIPPETS.find(s => s.id === 'nav').code);
  if (/hero|первый экран|баннер/.test(t)) return g(SNIPPETS.find(s => s.id === 'hero').code);
  if (/футер|подвал|footer/.test(t)) return g(SNIPPETS.find(s => s.id === 'footer').code);
  if (/таблиц|table/.test(t)) return g(SNIPPETS.find(s => s.id === 'list').code);
  if (/градиент|gradient/.test(t)) return g(`.gradient {\n  min-height: 180px;\n  border-radius: 24px;\n  background: linear-gradient(135deg, ${state.settings.accent}, ${randomColor()});\n}`, 'css', 'Градиент готов.');
  if (/сетк|grid/.test(t)) return g(`display: grid;\ngrid-template-columns: repeat(auto-fit, minmax(220px, 1fr));\ngap: 16px;`, 'css');
  if (/центрир|center/.test(t)) return g(`display: grid;\nplace-items: center;\nmin-height: 100vh;`, 'css');
  if (/анимац|animation|появлен/.test(t)) return g(`@keyframes fadeUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: none; } }\n.animated { animation: fadeUp .6s ease both; }`, 'css');
  if (/график|chart/.test(t)) return g(`<canvas id="chart" width="500" height="260"></canvas>\n<script>\nconst ctx = document.getElementById('chart').getContext('2d');\nconst data = [12, 19, 7, 15, 23];\ndata.forEach((v, i) => { ctx.fillStyle = '#7c6cf6'; ctx.fillRect(i * 95 + 20, 240 - v * 8, 60, v * 8); });\n</script>`);
  if (/fetch|запрос|api/.test(t)) return g(SNIPPETS.find(s => s.id === 'fetch').code, 'js');
  if (/debounce|задерж/.test(t)) return g(SNIPPETS.find(s => s.id === 'debounce').code, 'js');
  if (/наблюдател|observer|скролл/.test(t)) return g(SNIPPETS.find(s => s.id === 'intersection').code, 'js');
  if (/слайдер|slider|карусел/.test(t)) return g(SNIPPETS.find(s => s.id === 'slider').code);
  if (/тултип|tooltip|подсказк/.test(t)) return g(SNIPPETS.find(s => s.id === 'tooltip').code);
  if (/скелет|страниц|html5|шаблон/.test(t)) return g(SNIPPETS.find(s => s.id === 'html5').code);
  return g(`<!-- ${q(text)} -->\n<section class="generated">\n  <h2>Новый блок</h2>\n  <p>Опишите детальнее: «сделай карточку товара», «создай форму логина», «сгенерируй график».</p>\n</section>\n<style>\n.generated { padding: 28px; border-radius: 24px; background: ${state.settings.accent}22; border: 1px solid ${state.settings.accent}55; }\n</style>`);
}
function q(s) { return String(s).replace(/[<>&"]/g, ''); }
