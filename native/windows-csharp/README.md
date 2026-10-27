# Нативный хост Runlet (C# / WinForms + WebView2) — опционально

Это **не замена** основной Electron-сборке, а демонстрация реалистичного пути к
«нативной программе». Здесь нативные: окно ОС, рамка, строка меню, диалоги.
Внутри окна через WebView2 грузится тот же `app/` (HTML, CSS, SVG-иконки,
CodeMirror), что и в Electron. Node helper (`scripts/serve.mjs`) работает
скрытым фоновым процессом: он отдаёт страницу, раздаёт Live Server, держит
Python-движок анализа и подставляет токен REST API.

## Зачем так

VS Code тоже сделан на Electron (Chromium + Node.js + TypeScript), а не на C++.
Полностью переписать интерфейс на C++/C# означало бы заново написать редактор,
предпросмотр в песочнице, анализ, Live Server и 3D. Нативный хост поверх WebView
даёт системное окно и меню, сохраняя все фичи и SVG-иконки.

## Сборка (только Windows)

Нужны: Windows 10/11, .NET 8 SDK, WebView2 Runtime, Node.js 20+.

```powershell
cd Runlet
npm install --ignore-scripts
npm run build
$env:RUNLET_ROOT = (Get-Location).Path   # либо хост найдёт корень сам
cd native\windows-csharp
dotnet run
```

`dotnet run` поднимет `node scripts/serve.mjs` на `127.0.0.1:4173` и откроет его
в WebView2. Меню отправляют команды тем же реестром `window.Runlet.runCommand`,
что и системное меню Electron / веб-`#menuBar`.

## Ограничения

- Файл не компилируется в Linux-песочнице основной разработки (нет `dotnet` и
  WebView2) — поэтому он помечен как опциональный и не участвует в `npm test`.
- IPC из `electron/preload.cjs` здесь недоступен: функции «открыть папку с
  диска», «сохранить на диск», «Live Server в отдельном порту», «popout» и
  настоящие нативные диалоги нужно реализовать через `CoreWebView2` messaging
  и WinForms-диалоги — это следующий шаг.
- Для Linux/macOS аналогичный хост делается на C++ Qt + `QWebEngineView`
  (или Swift/WKWebView на macOS) по той же схеме: заменить только хост, оставить
  `app/` без изменений.

Основная рабочая версия — `npm start` (Electron) и `npm run web` (браузер).
