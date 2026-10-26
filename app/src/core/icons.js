/* Runlet icon system. All UI glyphs are inline SVG (no emoji, no icon fonts,
   no external requests). Symbols use currentColor so themes just work. */

const P = {
  play: '<path d="M8 5.5 18 12 8 18.5Z" fill="currentColor" stroke="none"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 6.3M20 5v6h-6"/>',
  format: '<path d="M4 6h16M4 10h10M4 14h16M4 18h7"/>',
  save: '<path d="M5 3h11l3 3v15H5zM8 3v6h8V3M8 21v-7h8v7"/>',
  download: '<path d="M12 3v12m0 0 4-4m-4 4-4-4M4 19h16"/>',
  upload: '<path d="M12 16V4m0 0-4 4m4-4 4 4M4 19h16"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  settings: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M19 5l-2 2M7 17l-2 2"/>',
  sliders: '<path d="M4 7h9m4 0h3M4 17h3m4 0h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  columns: '<rect x="3" y="4" width="5" height="16" rx="1.3"/><rect x="9.5" y="4" width="5" height="16" rx="1.3"/><rect x="16" y="4" width="5" height="16" rx="1.3"/>',
  rows: '<rect x="3" y="4" width="18" height="4.3" rx="1.3"/><rect x="3" y="9.8" width="18" height="4.3" rx="1.3"/><rect x="3" y="15.6" width="18" height="4.3" rx="1.3"/>',
  tabs: '<path d="M3 8a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
  theme: '<path d="M12 3a9 9 0 1 0 9 9 7 7 0 0 1-9-9Z"/>',
  density: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  chart: '<path d="M4 19V5m0 14h16M7 15l4-5 3 3 5-7"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
  file: '<path d="M6 3h8l4 4v14H6zM14 3v5h4"/>',
  files: '<path d="M8 3h7l4 4v10M5 7v14h11l3-3V7Z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  check: '<path d="m4 12 5 5L20 6"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  chevronRight: '<path d="m9 6 6 6-6 6"/>',
  chevronUp: '<path d="m6 15 6-6 6 6"/>',
  arrowUp: '<path d="M12 19V5m0 0-5 5m5-5 5 5"/>',
  arrowDown: '<path d="M12 5v14m0 0-5-5m5 5 5-5"/>',
  arrowLeft: '<path d="M19 12H5m0 0 5-5m-5 5 5 5"/>',
  arrowRight: '<path d="M5 12h14m0 0-5-5m5 5-5 5"/>',
  maximize: '<path d="M4 9V4h5M20 15v5h-5M4 4l6 6M20 20l-6-6"/>',
  minimize: '<path d="M4 9h6M20 15h-6M4 9l6 6M20 15l-6-6"/>',
  external: '<path d="M13 4h7v7M20 4 9 15M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  grid: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>',
  ruler: '<path d="M3 8h18v8H3zM7 8v4M11 8v3M15 8v4M19 8v3"/>',
  droplet: '<path d="M12 3s6 6.5 6 10.5A6 6 0 0 1 6 13.5C6 9.5 12 3 12 3Z"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3"/>',
  rotate: '<path d="M20 11a8 8 0 1 0-2.3 6.3M20 5v6h-6"/>',
  monitor: '<rect x="2.5" y="4" width="19" height="13" rx="2"/><path d="M9 21h6M12 17v4"/>',
  tablet: '<rect x="5" y="2.5" width="14" height="19" rx="2"/><path d="M11 18.5h2"/>',
  phone: '<rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M11 18.5h2"/>',
  resize: '<path d="M4 14 14 4M8 18 18 8"/>',
  code: '<path d="m8 6-6 6 6 6m8-12 6 6-6 6m-2-14-4 16"/>',
  cube: '<path d="m12 2 9 5v10l-9 5-9-5V7Z"/><path d="m3 7 9 5 9-5M12 12v10"/>',
  box: '<path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5Z"/><path d="M3 7.5 12 12l9-4.5M12 12v9"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5Z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/>',
  book: '<path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v17H6.5A2.5 2.5 0 0 0 4 21.5Z"/><path d="M4 18.5A2.5 2.5 0 0 1 6.5 16H20"/>',
  puzzle: '<path d="M9 3h6v3a2 2 0 1 0 4 0V3h2v6h-3a2 2 0 1 0 0 4h3v6h-6v-3a2 2 0 1 0-4 0v3H3v-6h3a2 2 0 1 0 0-4H3V3Z"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  terminal: '<rect x="2.5" y="4" width="19" height="16" rx="2"/><path d="m6 9 3 3-3 3M12 15h6"/>',
  bug: '<rect x="6" y="7" width="12" height="12" rx="4"/><path d="M9 7V5a3 3 0 0 1 6 0v2M3 11h3m12 0h3M3 16h3m12 0h3M6 20l-2 2m14-2 2 2"/>',
  network: '<circle cx="12" cy="4" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="19" r="2"/><path d="M12 6v6m0 0-6 6m6-6 6 6"/>',
  database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  gauge: '<path d="M4 18a8 8 0 1 1 16 0"/><path d="m12 14 4-4"/><circle cx="12" cy="18" r="1.4" fill="currentColor" stroke="none"/>',
  journal: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h8M8 11h8M8 15h5"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  edit: '<path d="M4 20h4l11-11-4-4L4 16Z"/><path d="m14 6 4 4"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6m4-6v6"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
  server: '<rect x="3" y="3" width="18" height="8" rx="2"/><rect x="3" y="13" width="18" height="8" rx="2"/><path d="M7 7h.01M7 17h.01"/>',
  window: '<rect x="2.5" y="4" width="19" height="16" rx="2"/><path d="M2.5 9h19M6 6.5h.01M9 6.5h.01M12 6.5h.01"/>',
  keyboard: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 13h.01M10 13h.01M14 13h.01M18 13h.01M8 16h8"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5h.01"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.9.4-1 1.1-1 1.7M12 17h.01"/>',
  home: '<path d="M4 11 12 4l8 7v9H4Z"/><path d="M9 20v-6h6v6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  eye: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z"/><circle cx="12" cy="12" r="2.6"/>',
  eyeOff: '<path d="M4 4 20 20M9.9 5.2A11 11 0 0 1 12 5c6.5 0 10 7 10 7a16 16 0 0 1-3 3.6M6.2 7.6C3.5 9.2 2 12 2 12s3.5 7 10 7a10 10 0 0 0 3.3-.5"/>',
  filter: '<path d="M3 5h18l-7 8v6l-4 2v-8Z"/>',
  link: '<path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="m4 17 5-5 3 3 4-4 4 4"/>',
  palette: '<path d="M12 3a9 9 0 0 0 0 18c1.4 0 2-1 2-2s-.8-2 .3-2.7A2 2 0 0 0 15 12a8 8 0 0 1-3-9Z"/><circle cx="7.5" cy="11" r="1" fill="currentColor" stroke="none"/><circle cx="10" cy="7" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="8" r="1" fill="currentColor" stroke="none"/>',
  scissors: '<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><path d="M8 8 20 18M8 16 20 6"/>',
  brackets: '<path d="M8 4H5a2 2 0 0 0-2 2v4a2 2 0 0 1-2 2 2 2 0 0 1 2 2v4a2 2 0 0 0 2 2h3M16 4h3a2 2 0 0 1 2 2v4a2 2 0 0 0 2 2 2 2 0 0 0-2 2v4a2 2 0 0 1-2 2h-3"/>',
  indent: '<path d="M4 6h16M4 12h10M4 18h16M17 10l3 2-3 2"/>',
  wrap: '<path d="M4 6h16M4 12h13a3 3 0 0 1 0 6h-3m0 0 2-2m-2 2 2 2M4 18h5"/>',
  pin: '<path d="M9 3h6l-1 6 4 3v2H6v-2l4-3Z"/><path d="M12 14v7"/>',
  more: '<circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none"/>',
  cursor: '<path d="M5 3v16l4-4 3 5 2-1-3-5h6Z"/>',
  move: '<path d="M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19"/>',
  moon: '<path d="M20 14A8 8 0 0 1 10 4a8 8 0 1 0 10 10Z"/>',
  contrast: '<circle cx="12" cy="12" r="9"/><path d="M12 3v18a9 9 0 0 0 0-18Z" fill="currentColor" stroke="none"/>',
  spark: '<path d="M12 3v4m0 10v4M3 12h4m10 0h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18"/>',
  package: '<path d="m12 3 9 4.5v9L12 21l-9-4.5v-9Z"/><path d="M3 7.5 12 12l9-4.5M12 12v9"/>',
  archive: '<rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v11h14V9M10 13h4"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5"/><path d="M12 8v5l3 2"/>',
  shield: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6Z"/><path d="m9 12 2 2 4-4"/>',
  wand: '<path d="m4 20 10-10M13 6l5 5M6 3l1 2 2 1-2 1-1 2-1-2-2-1 2-1ZM19 14l.7 1.3L21 16l-1.3.7L19 18l-.7-1.3L17 16l1.3-.7Z"/>',
  text: '<path d="M4 6V4h16v2M12 4v16M9 20h6"/>',
  braces: '<path d="M9 3H7a2 2 0 0 0-2 2v4a2 2 0 0 1-2 2 2 2 0 0 1 2 2v6a2 2 0 0 0 2 2h2M15 3h2a2 2 0 0 1 2 2v4a2 2 0 0 0 2 2 2 2 0 0 0-2 2v6a2 2 0 0 1-2 2h-2"/>',
  users: '<circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6m2 9v-2a5 5 0 0 0-2-4"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9 2 2-2 2 1 1-2 2-1-1-2 2 2 2-2 2-2-2-2 2"/>'
};

export const ICON_NAMES = Object.keys(P);

/** Returns an SVG string. Always uses currentColor; never injects user data. */
export function icon(name, size = 16, cls = 'ico') {
  const body = P[name] || P.info;
  return `<svg class="${cls}" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

/** DOM helper used by the toolbar / palette / window manager. */
export function iconEl(name, size = 16, cls = 'ico') {
  const wrap = document.createElement('span');
  wrap.innerHTML = icon(name, size, cls);
  return wrap.firstElementChild;
}

/** Remove decorative emoji from legacy strings (keeps words & punctuation). */
export function deEmoji(text) {
  return String(text ?? '')
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2B00}-\u{2BFF}]/gu, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
