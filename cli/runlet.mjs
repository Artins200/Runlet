#!/usr/bin/env node
/* Runlet CLI — manage projects and run the Python analysis engine from a terminal.
   node cli/runlet.mjs <command> [options]
*/
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [, , cmd = 'help', ...args] = process.argv;
const flag = (name, def = null) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('-') ? args[i + 1] : (i >= 0 ? true : def);
};
const py = () => process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');

function runEngine(job) {
  return new Promise((resolve, reject) => {
    const p = spawn(py(), [path.join(root, 'analysis/engine.py')], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', d => out += d);
    p.stderr.on('data', d => err += d);
    p.on('close', code => { if (code) return reject(new Error(err || 'engine failed')); try { resolve(JSON.parse(out)); } catch (e) { reject(e); } });
    p.stdin.end(JSON.stringify(job));
  });
}
function collect(dir = '.') {
  const files = {};
  const walk = d => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'dist') continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.(html?|css|js|mjs|ts|jsx|tsx|json|md|svg|txt)$/i.test(e.name)) {
        files[path.relative(dir, full).replace(/\\/g, '/')] = fs.readFileSync(full, 'utf8');
      }
    }
  };
  if (fs.statSync(dir).isDirectory()) walk(dir);
  else files[path.basename(dir)] = fs.readFileSync(dir, 'utf8');
  return files;
}

async function main() {
  switch (cmd) {
    case 'help':
      console.log(`Runlet CLI 1.0

Команды:
  list                     файлы проекта в текущей папке
  analyze [path]           анализ кода Python-движком (--md, --json)
  build [path]             собрать один HTML-файл (-o output.html)
  new [name]               создать проект из шаблона
  snapshot                 сохранить снимок проекта в .runlet/
  report                   краткая сводка по движку
  serve --port 4173        запустить веб-версию редактора
  api                      проверить локальный REST API Electron

Примеры:
  node cli/runlet.mjs analyze . --md > report.md
  node cli/runlet.mjs build index.html -o dist/index.html
`);
      break;
    case 'list': {
      const files = collect(args[0] || '.');
      for (const [p, c] of Object.entries(files)) console.log(`${String(c.length).padStart(8)}  ${p}`);
      break;
    }
    case 'analyze': {
      const target = args.find(a => !a.startsWith('-')) || '.';
      const files = collect(target);
      const entry = Object.keys(files).find(f => /\.html?$/i.test(f)) || Object.keys(files)[0];
      const r = await runEngine({ files, entry, deps: [], locale: 'ru' });
      if (flag('--json')) console.log(JSON.stringify(r, null, 2));
      else if (flag('--md')) console.log(r.markdown);
      else {
        console.log(`\n🐍 ${r.engine} · ${r.elapsed_ms} мс · оценка ${r.score}/100\n`);
        console.log(r.summary.headline);
        console.log(r.summary.description + '\n');
        for (const [i, s] of r.summary.steps.entries()) console.log(`  ${i + 1}. (${s.confidence}) ${s.text}`);
        console.log('\nОшибки и предупреждения:');
        for (const d of r.diagnostics.slice(0, 40)) console.log(`  ${d.sev.toUpperCase().padEnd(8)} ${d.file}:${d.line}  ${d.msg}`);
        console.log(`\nВсего замечаний: ${r.diagnostics.length}. Полный отчёт: --md`);
      }
      break;
    }
    case 'build': {
      const target = args.find(a => !a.startsWith('-') && a !== flag('-o')) || 'index.html';
      const out = flag('-o', 'dist/index.html');
      let html = fs.readFileSync(path.resolve(target), 'utf8');
      const dir = path.dirname(path.resolve(target));
      html = html.replace(/<link\b[^>]*href=["']([^"']+\.css)["'][^>]*>/gi, (m, href) => {
        const f = path.join(dir, href);
        return fs.existsSync(f) ? `<style>\n${fs.readFileSync(f, 'utf8')}\n</style>` : m;
      });
      html = html.replace(/<script\b[^>]*src=["']([^"']+\.js)["'][^>]*>\s*<\/script>/gi, (m, src) => {
        const f = path.join(dir, src);
        if (!fs.existsSync(f)) return m;
        return `<script>\n${fs.readFileSync(f, 'utf8')}\n</script>`;
      });
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, html);
      console.log(`Собрано: ${out} (${html.length} символов)`);
      break;
    }
    case 'new': {
      const name = args[0] || 'runlet-project';
      fs.mkdirSync(name, { recursive: true });
      fs.writeFileSync(path.join(name, 'index.html'), `<!DOCTYPE html>\n<html lang="ru">\n<head>\n  <meta charset="UTF-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n  <title>${name}</title>\n  <link rel="stylesheet" href="style.css">\n</head>\n<body>\n  <main><h1>Привет, Runlet!</h1><button id="btn">Нажми</button><p id="out"></p></main>\n  <script src="script.js"></script>\n</body>\n</html>\n`);
      fs.writeFileSync(path.join(name, 'style.css'), 'body{font-family:system-ui;display:grid;place-items:center;min-height:100vh;background:#10132a;color:#fff}button{border:0;border-radius:14px;padding:12px 20px;background:#7c6cf6;color:#fff}\n');
      fs.writeFileSync(path.join(name, 'script.js'), 'let n = 0;\ndocument.querySelector("#btn").addEventListener("click", () => {\n  document.querySelector("#out").textContent = "Кликов: " + ++n;\n});\n');
      console.log('Создан проект:', name);
      break;
    }
    case 'snapshot': {
      fs.mkdirSync('.runlet', { recursive: true });
      const file = path.join('.runlet', `snapshot-${Date.now()}.json`);
      fs.writeFileSync(file, JSON.stringify({ files: collect('.'), at: Date.now() }, null, 2));
      console.log('Снапшот:', file);
      break;
    }
    case 'serve': {
      const port = flag('--port', '4173');
      const p = spawn(process.execPath, [path.join(root, 'scripts/serve.mjs')], { stdio: 'inherit', env: { ...process.env, PORT: String(port) } });
      p.on('exit', code => process.exit(code || 0));
      break;
    }
    case 'api': {
      try {
        const r = await fetch('http://127.0.0.1:7788/api/health');
        console.log('REST API:', await r.json());
      } catch (e) { console.log('REST API недоступен — запустите Electron-версию редактора.'); }
      break;
    }
    case 'report': {
      const r = await runEngine({ files: { 'index.html': '<html><body><h1>Test</h1></body></html>' }, entry: 'index.html' });
      console.log(`Движок ${r.engine}: ${Object.keys(r).length} полей отчёта, ${r.diagnostics.length} проверок.`);
      break;
    }
    default: console.log('Неизвестная команда:', cmd, '\nnode cli/runlet.mjs help');
  }
}
main().catch(e => { console.error('Ошибка:', e.message); process.exit(1); });
