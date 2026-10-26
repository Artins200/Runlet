/* Full test suite: syntax, build, Python engine, renderer boot, preview bridge. */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`);
  cond ? pass++ : fail++;
};
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { cwd: root, encoding: 'utf8', ...opts });

console.log('\n╔══════════════════════════════════════════════╗');
console.log('║   Runlet test suite                          ║');
console.log('╚══════════════════════════════════════════════╝\n');

// 1. Syntax of every source file
const jsFiles = [];
const walk = d => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (['node_modules', '.git', 'dist'].includes(e.name)) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(mjs|cjs|js)$/.test(e.name)) jsFiles.push(p);
  }
};
for (const d of ['app/src', 'electron', 'scripts', 'cli', 'public']) if (fs.existsSync(path.join(root, d))) walk(path.join(root, d));
jsFiles.push(path.join(root, 'app/dist/bundle.js'));
let syntaxBad = [];
for (const f of jsFiles) {
  const r = run(process.execPath, ['--check', f]);
  if (r.status !== 0) syntaxBad.push(path.relative(root, f) + ': ' + r.stderr.trim().slice(0, 160));
}
ok(`Синтаксис JS (${jsFiles.length} файлов)`, syntaxBad.length === 0, syntaxBad.slice(0, 3).join(' | '));

// 2. Python engine syntax + selftest
const py = process.env.PYTHON || 'python3';
const compile = run(py, ['-m', 'py_compile', 'analysis/engine.py']);
ok('Python engine компилируется', compile.status === 0, compile.stderr?.slice(0, 160));
const selftest = run(py, ['analysis/engine.py', '--selftest']);
try {
  const r = JSON.parse(selftest.stdout);
  ok('Python selftest: отчёт', r.ok && r.score >= 0 && r.diagnostics.length > 5,
    `оценка ${r.score}, ${r.diagnostics.length} замечаний`);
  ok('Python selftest: ошибки найдены', r.diagnostics.some(d => d.sev === 'error' && d.id === 'JS060'));
  ok('Python selftest: поведение', r.behavior.events.length > 0 && r.summary.steps.length >= 4);
  ok('Python selftest: markdown', (r.markdown || '').length > 500);
} catch (e) { ok('Python selftest: отчёт', false, e.message); }

// 3. Build
const build = run(process.execPath, ['scripts/build.mjs']);
ok('esbuild сборка', build.status === 0, build.stdout.trim().split('\n').pop());
ok('bundle.js существует', fs.existsSync(path.join(root, 'app/dist/bundle.js')),
  (fs.statSync(path.join(root, 'app/dist/bundle.js')).size / 1024 / 1024).toFixed(2) + ' МБ');

// 4. Feature map / command coverage
const featSrc = fs.readFileSync(path.join(root, 'app/src/core/data.js'), 'utf8');
const items = (featSrc.match(/from: \d+, items: \[/g) || []).length;
const total = [...featSrc.matchAll(/from: \d+, items: \[([\s\S]*?)\] \}/g)]
  .reduce((n, m) => n + (m[1].match(/'[^']*'/g) || []).length, 0);
ok('Карта идей содержит 500 пунктов', total === 500, `найдено ${total}`);
const cmdSrc = fs.readFileSync(path.join(root, 'app/src/core/commands.js'), 'utf8');
const registered = new Set([...cmdSrc.matchAll(/cmd\('([^']+)'/g)].map(m => m[1]));
const referenced = new Set();
for (const f of [path.join(root, 'app/index.html'), ...jsFiles.filter(f => f.includes('app/src/core'))]) {
  const s = fs.readFileSync(f, 'utf8');
  for (const m of s.matchAll(/data-cmd=["']([\w]+)["']/g)) referenced.add(m[1]);
}
const missing = [...referenced].filter(id => !registered.has(id));
ok('Кнопки привязаны к командам', missing.length === 0, missing.length ? 'нет: ' + missing.join(', ') : `${referenced.size} кнопок → ${registered.size} команд`);
const coreSrc = fs.readFileSync(path.join(root, 'app/src/core/core.js'), 'utf8');
const kbBlock = (coreSrc.match(/keybindings: \{([\s\S]*?)\n  \}/) || [])[1] || '';
const keybindings = (kbBlock.match(/'\w+': '[^']+'/g) || []).length;
ok('Горячие клавиши настроены', keybindings >= 15, keybindings + ' combos');

// 5. CLI
const cli = run(process.execPath, ['cli/runlet.mjs', 'report']);
ok('CLI → Python engine', cli.status === 0 && /Движок/.test(cli.stdout), cli.stdout.trim().slice(0, 90));

// 6. Renderer smoke test (jsdom)
const smoke = run(process.execPath, ['scripts/smoke.mjs']);
const smokeOut = (smoke.stdout || '') + (smoke.stderr || '');
ok('Renderer boot (jsdom)', smoke.status === 0, smokeOut.split('\n').filter(l => /checks passed|Errors captured/.test(l)).join(', '));
ok('Python engine через браузер', /runlet-python/.test(smokeOut), smokeOut.match(/analysis report received[^\n]*/)?.[0] || '');

// 7. srcdoc scripts syntax
const src = run(process.execPath, ['scripts/checksrcdoc.mjs']);
const srcOut = (src.stdout || '') + (src.stderr || '');
ok('srcdoc: скрипты валидны', src.status === 0 && /bad scripts: 0/.test(srcOut), srcOut.match(/inline scripts: \d+/)?.[0] || '');
ok('srcdoc: JS инструментирован однократно', /inline scripts: 3/.test(srcOut));

// 8. exercise commands/dialogs
const ex = run(process.execPath, ['scripts/exercise.mjs']);
const exOut = (ex.stdout || '') + (ex.stderr || '');
ok('Команды и диалоги (93)', ex.status === 0, exOut.match(/Выполнено команд: \d+\/\d+/)?.[0] || exOut.slice(-120));

// 9. bridge runtime
const bridge = run(process.execPath, ['scripts/testbridge.mjs']);
const bridgeOut = (bridge.stdout || '') + (bridge.stderr || '');
ok('Preview bridge runtime', bridge.status === 0, bridgeOut.split('\n').filter(l => l.includes('✅')).length + ' проверок');
ok('Console / eval / DOM / tracer', /bridge sends ready/.test(bridgeOut) && /tracer recorded lines/.test(bridgeOut));

console.log(`\n${pass} прошло, ${fail} упало.\n`);
process.exit(fail ? 1 : 0);
