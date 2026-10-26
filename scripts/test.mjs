/* Full test suite: syntax, build, Python engine, UI boot, commands, preview
   bridge, dependency audit and security hardening. Self-contained: starts its
   own hardened dev server on a private test port. */
import { spawnSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEST_PORT = +(process.env.RUNLET_TEST_PORT || 4188);
const ORIGIN = `http://127.0.0.1:${TEST_PORT}`;
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`);
  cond ? pass++ : fail++;
};
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, {
  cwd: root, encoding: 'utf8', maxBuffer: 40 * 1024 * 1024,
  env: { ...process.env, RUNLET_TEST_ORIGIN: ORIGIN }, ...opts
});

console.log('\n╔══════════════════════════════════════════════╗');
console.log('║   Runlet test suite                          ║');
console.log('╚══════════════════════════════════════════════╝\n');

// Start a dedicated, hardened dev server for browser/HTTP tests.
const server = spawn(process.execPath, ['scripts/serve.mjs'], {
  cwd: root, env: { ...process.env, PORT: String(TEST_PORT), HOST: '127.0.0.1' },
  stdio: ['ignore', 'pipe', 'pipe']
});
let serverLog = '';
server.stdout.on('data', d => serverLog += d);
server.stderr.on('data', d => serverLog += d);
let healthy = false;
for (let i = 0; i < 60; i++) {
  try {
    const r = await fetch(ORIGIN + '/api/health');
    if (r.ok) { healthy = true; break; }
  } catch (_) { /* not up yet */ }
  await new Promise(r => setTimeout(r, 150));
}
ok('Тестовый сервер запущен', healthy, serverLog.split('\n').find(l => l.includes('API token')) ? 'token generated' : '');

try {
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

  // 2. Python engine
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

  // 5. CLI
  const cli = run(process.execPath, ['cli/runlet.mjs', 'report']);
  ok('CLI → Python engine', cli.status === 0 && /Движок/.test(cli.stdout), cli.stdout.trim().slice(0, 90));

  // 6. npm audit snapshot for the security suite
  const audit = run('npm', ['audit', '--json']);
  fs.writeFileSync('/tmp/runlet-audit.json', audit.stdout || '{"metadata":{"vulnerabilities":{"total":-1}}}');
  const auditMeta = JSON.parse(fs.readFileSync('/tmp/runlet-audit.json', 'utf8')).metadata?.vulnerabilities;
  ok('npm audit: 0 уязвимостей', auditMeta?.total === 0, JSON.stringify(auditMeta));

  // 7. Renderer smoke test (jsdom)
  const smoke = run(process.execPath, ['scripts/smoke.mjs']);
  const smokeOut = (smoke.stdout || '') + (smoke.stderr || '');
  ok('Renderer boot (jsdom)', smoke.status === 0, smokeOut.split('\n').filter(l => /checks passed|Errors captured/.test(l)).join(', '));
  ok('Python engine через браузер', /runlet-python/.test(smokeOut), smokeOut.match(/analysis report received[^\n]*/)?.[0] || '');

  // 8. srcdoc scripts syntax
  const src = run(process.execPath, ['scripts/checksrcdoc.mjs']);
  const srcOut = (src.stdout || '') + (src.stderr || '');
  ok('srcdoc: скрипты валидны', src.status === 0 && /bad scripts: 0/.test(srcOut), srcOut.match(/inline scripts: \d+/)?.[0] || '');
  ok('srcdoc: JS инструментирован однократно', /inline scripts: 3/.test(srcOut));

  // 9. exercise commands/dialogs
  const ex = run(process.execPath, ['scripts/exercise.mjs']);
  const exOut = (ex.stdout || '') + (ex.stderr || '');
  ok('Команды и диалоги', ex.status === 0, exOut.match(/Выполнено команд: \d+\/\d+/)?.[0] || exOut.slice(-120));

  // 10. bridge runtime
  const bridge = run(process.execPath, ['scripts/testbridge.mjs']);
  const bridgeOut = (bridge.stdout || '') + (bridge.stderr || '');
  ok('Preview bridge runtime', bridge.status === 0, bridgeOut.split('\n').filter(l => l.includes('✅')).length + ' проверок');

  // 11. security regression suite
  const sec = run(process.execPath, ['scripts/security.mjs']);
  const secOut = (sec.stdout || '') + (sec.stderr || '');
  const secPass = secOut.split('\n').filter(l => l.includes('✅')).length;
  const secFail = secOut.split('\n').filter(l => l.includes('❌')).length;
  // 12. Live Server smoke
  const live = await (async () => {
    try {
      const idx = await (await fetch(ORIGIN + '/')).text();
      const token = (/name="runlet-api-token" content="([a-f0-9]{32,128})"/.exec(idx) || [])[1];
      const put = await fetch(ORIGIN + '/api/live/project', {
        method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Runlet-Token': token },
        body: JSON.stringify({ files: { 'index.html': '<!doctype html><html><body><h1>Live</h1></body></html>' }, entry: 'index.html' })
      });
      const page = await fetch(ORIGIN + '/live/');
      const html = await page.text();
      const ver = await (await fetch(ORIGIN + '/live/__version')).json();
      const bad = await fetch(ORIGIN + '/live/../../../etc/passwd');
      return { put: put.status, page: page.status, injected: /__version/.test(html), ver: ver.v, traversal: bad.status };
    } catch (e) { return { error: e.message }; }
  })();
  ok('Live Server: запуск, раздача и автообновление', live.put === 200 && live.page === 200 && live.injected === true,
    `PUT ${live.put}, GET ${live.page}, v=${live.ver}`);
  ok('Live Server: path traversal отклонён', live.traversal === 404, String(live.traversal));

  ok('Security suite', sec.status === 0, `${secPass} проверок` + (secFail ? `, ${secFail} упало` : ''));
  if (sec.status !== 0) console.log(secOut.split('\n').filter(l => l.includes('❌')).join('\n').slice(0, 2000));
} finally {
  server.kill('SIGTERM');
}

console.log(`\n${pass} прошло, ${fail} упало.\n`);
process.exit(fail ? 1 : 0);
