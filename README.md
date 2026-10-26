# Liveforge

> Write code. Run it instantly. See the result.

**Liveforge** is a browser-based HTML/CSS/JS editor and playground with live preview, console, virtual file system, CDN libraries, snippets, and AI assistance. Write code, see the result immediately, debug it, and share your project — no installation, no build step, no setup.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)
[![Made with JavaScript](https://img.shields.io/badge/Made%20with-JavaScript-f7df1e.svg)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![Status](https://img.shields.io/badge/status-alpha-orange.svg)]()


## ✨ Why Liveforge?

Setting up a local dev environment for a quick experiment is overkill. Liveforge removes the friction between "I want to try some code" and "I see the result in my browser."

- **Zero setup.** Open the page and start coding.
- **Instant feedback.** Live preview updates as you type.
- **Everything in one window.** Editor, preview, console, files — no tab-switching.
- **Built for learning and prototyping.** Great for beginners, teachers, students, and developers who need a fast scratchpad.
- **Extensible.** Plugin system and API for custom workflows.

---

## 🚀 Features

### Editor
- Split panels for HTML, CSS, and JavaScript
- Syntax highlighting and autocompletion for all three languages
- Emmet support (`.container` → `<div class="container">`)
- Auto-close brackets, quotes, and HTML tags
- Multi-cursor editing, block selection, and line manipulation
- Format on demand (HTML / CSS / JS / JSON)
- Code folding, minimap, and breadcrumbs
- Customizable font, size, tab width, and theme

### Live Preview
- Real-time iframe preview with debounced auto-update
- Manual "Run" button
- CSS hot swap and JS hot reload
- Device emulation (mobile, tablet, desktop)
- Fullscreen and pop-out preview modes
- Overlay grid, rulers, and guides
- Click-to-inspect element, code ⇄ preview highlighting
- Sandboxed iframe with configurable permissions

### Console & Debugging
- Console with log levels, filtering, and search
- `console.log`, `warn`, `error`, `table`, `group`, `time` support
- Interactive REPL input with history and autocomplete
- Error stack traces with source mapping
- Network request inspector
- Storage inspector (`localStorage`, `sessionStorage`, cookies)

### Virtual File System
- Create, rename, move, and delete files and folders
- Drag-and-drop upload from your computer
- Asset support (images, fonts, audio, video)
- Project export to ZIP or single HTML file
- Import from ZIP, GitHub, or URL
- Save to IndexedDB with version snapshots

### Libraries & Build
- One-click CDN import (Tailwind, Bootstrap, React, Vue, Three.js, D3, etc.)
- ES module resolution via `import`
- Optional in-browser transpilation (TypeScript, JSX, Sass, Less, Pug)
- Minification on demand
- Custom snippet library with placeholders

### Sharing & Collaboration
- Generate shareable read-only links
- Embed projects via iframe with URL parameters
- Export to CodePen, JSFiddle, StackBlitz, GitHub Gist
- Real-time collaborative editing (CRDT-based)
- Comments on lines of code

