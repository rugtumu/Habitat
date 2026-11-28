'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');
const { makeDocument } = require('./fakeDom');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

// A page with just enough in it for the theme colour to be read off.
function fakePage(backgrounds) {
  const meta = { content: '#1a1a2e', getAttribute() { return this.content; }, setAttribute(name, value) { this.content = value; } };
  const listeners = {};
  const element = (name) => (name in backgrounds ? { name } : null);
  globalThis.document = {
    documentElement: {},
    body: { name: 'body' },
    querySelector(selector) {
      if (selector === 'meta[name="theme-color"]') return meta;
      const region = selector.match(/data-haven-region="([\w-]+)"/)?.[1];
      return region ? element(region) : null;
    },
    addEventListener(type, listener) { listeners[type] = listener; }
  };
  globalThis.window = { addEventListener(type, listener) { listeners[`window:${type}`] = listener; } };
  globalThis.getComputedStyle = (el) => ({ backgroundColor: backgrounds[el.name] ?? 'rgba(0, 0, 0, 0)' });
  globalThis.MutationObserver = class { constructor(callback) { listeners.mutation = callback; } observe() {} };
  return { meta, listeners };
}

async function mobileMethods() {
  return (await import(pathToFileURL(path.join(ROOT, 'public/js/modules/app-mobile.js')).href)).default;
}

// The sync also runs on a few timers (a theme file can finish loading late),
// so each test owns the clock and nothing fires after it ends.
function ownClock(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  return () => t.mock.timers.tick(2000);
}

test.afterEach(() => {
  for (const name of ['document', 'window', 'getComputedStyle', 'MutationObserver']) delete globalThis[name];
});

test('the phone browser bar takes the colour of the channel header', async (t) => {
  const settle = ownClock(t);
  const page = fakePage({ 'channel-header': 'rgb(30, 32, 36)', main: 'rgb(1, 2, 3)', body: 'rgb(9, 9, 9)' });
  (await mobileMethods())._setupThemeColorMeta();
  assert.equal(page.meta.content, '#1e2024');
  settle();
  assert.equal(page.meta.content, '#1e2024');
});

test('a theme with a clear header falls back to what shows through it', async (t) => {
  const settle = ownClock(t);
  const page = fakePage({ 'channel-header': 'rgba(0, 0, 0, 0)', main: 'rgba(20, 20, 30, 0.5)', body: 'rgb(26, 26, 46)' });
  (await mobileMethods())._setupThemeColorMeta();
  assert.equal(page.meta.content, '#1a1a2e', 'see-through layers are skipped, the first solid one is used');
  settle();
});

test('switching theme moves the browser bar with it', async (t) => {
  const settle = ownClock(t);
  const backgrounds = { 'channel-header': 'rgb(30, 32, 36)' };
  const page = fakePage(backgrounds);
  (await mobileMethods())._setupThemeColorMeta();
  backgrounds['channel-header'] = 'rgb(255, 255, 255)';
  page.listeners['haven:themes-changed']();
  settle();
  assert.equal(page.meta.content, '#ffffff');
  backgrounds['channel-header'] = 'rgb(0, 0, 0)';
  page.listeners.mutation();
  settle();
  assert.equal(page.meta.content, '#000000');
});

test('the app starts the theme colour sync on every device, not only in the app shell', () => {
  assert.match(read('public/js/app.js'), /this\._setupMobileBridge\(\);\s*\n\s*this\._setupThemeColorMeta\(\);/);
  const source = read('public/js/modules/app-mobile.js');
  const body = source.slice(source.indexOf('_setupThemeColorMeta() {'), source.indexOf('_reportThemeColor() {'));
  assert.doesNotMatch(body, /_isMobileApp/, 'a plain phone browser needs it as much as the shell does');
});

test('Habitat Grafit keeps the phone screens inside the screen', () => {
  const css = read('themes/habitat-grafit.theme.css');
  const phone = (css.match(/@media \(max-width: 480px\) \{[\s\S]*?\n\}\n/g) || []).join('\n');
  assert.match(phone, /\.modal\.modal-settings\s*\{[^}]*min-width:\s*0;/, 'Settings must not keep its 420px minimum on a 375px phone');
  assert.match(css, /\.input-actions-box,[\s\S]*?max-width:\s*calc\(100vw - 2\.5rem\)/, 'the folded tools menu stops at the screen edge');
  const header = (css.match(/@media \(max-width: 768px\) \{[\s\S]*?\n\}\n/g) || []).join('\n');
  assert.match(header, /\.channel-info\s*\{[^}]*flex:\s*1 1 auto;[^}]*min-width:\s*0;/, 'the channel name takes the free space in the header');
  // Text is only dropped where an icon stands in for it.
  assert.match(header, /\.btn-voice > span:has\(> \.haven-glyph\)\s*\{[^}]*font-size:\s*0;/);
});

const theme = read('themes/habitat-grafit.theme.css');
const { CSS: layout } = require('../plugins/HabitatLayout.plugin.js');

function media(css, condition) {
  return css.split('@media ' + condition + ' {').slice(1).map(block => block.split('\n}')[0]).join('\n');
}

test('the phone layout leaves server switching in the drawer', () => {
  assert.match(media(layout, '(max-width: 768px)'), /html\[data-habitat-layout="compact"\] #mobile-server-dropdown\s*\{ display: none;/);
  const core = media(read('public/css/style-mobile.css'), '(max-width: 768px)');
  assert.match(core, /\.mobile-servers-section\s*\{ display: block;/);
  assert.doesNotMatch(layout, /#mobile-servers-section\s*\{[^}]*display:\s*none/);
});

test('the coarse pointer minimum covers both axes of the phone controls', () => {
  const touch = media(theme, '(pointer: coarse)');
  const controls = touch.match(/([^{}]+)\{\s*min-width: 2\.75rem;\s*min-height: 2\.75rem;/)[1];
  for (const selector of ['[data-habitat-add-button]', '.mobile-panel-close', '[data-habitat-room-heading] button',
    '[data-habitat-jump]', '[data-habitat-call-view]', '[data-habitat-room-members]', '.mobile-srv-bubble',
    '[data-habitat-servers-button]', '.mobile-menu-btn', '.mobile-users-btn', '#search-toggle-btn',
    '[data-habitat-channel-tools] summary', '.btn-composer-plus', '.btn-send', '.icon-btn', '.msg-toolbar button',
    '.reaction-pick-btn', '.quick-switcher-item']) assert.ok(controls.includes(selector), selector);
  assert.match(touch, /\.mobile-servers-row:not\(\.collapsed\) \{\s*max-height: none;/);
});

test('touch options reserve the trailing edge even for badges appended after the button', () => {
  const css = media(theme, '(hover: none)');
  assert.match(css, /\.channel-item:has\(> \.channel-more-btn\) \{[^}]*padding-inline-end: 3rem;/);
  const button = css.match(/\.channel-item > \.channel-more-btn \{([^}]+)}/)[1];
  for (const rule of ['position: absolute', 'inset-inline-end: 0', 'width: 2.75rem', 'min-height: 2.75rem',
    'max-width: none', 'opacity: 1', 'pointer-events: auto']) assert.ok(button.includes(rule), rule);
});

test('main emoji and GIF pickers follow the composer padding box as the input grows', () => {
  const css = media(theme, '(max-width: 480px)');
  assert.match(css, /\[data-haven-region="composer"\] > :is\(\.emoji-picker, \.gif-picker\) \{\s*position: absolute;\s*bottom: 100% !important;/);
  assert.match(read('public/css/style-messages.css'), /\.message-input-area \{[^}]*position: relative;/);
});

test('the compact toast placement outranks both native shell selectors', () => {
  const rule = theme.match(/html\[data-habitat-layout="compact"\] body\[data-haven-page="app"\] #toast-container \{([^}]+)}/)[1];
  assert.match(rule, /top: auto;/);
  assert.match(rule, /bottom: calc\([^;]+var\(--hb-toast-clearance[^;]+env\(safe-area-inset-bottom/);
});

test('phone popovers can leave the header and the name ellipsizes at the available width', () => {
  assert.match(media(layout, '(max-width: 480px)'), /\.channel-header \{ overflow: visible;/);
  assert.match(media(theme, '(max-width: 768px)'), /\.channel-info > h3 \{[^}]*max-width: none;[^}]*text-overflow: ellipsis/);
});

test('the header call button takes its accessible name from the label updated for DMs', () => {
  const html = read('public/app.html');
  const id = html.match(/<button id="voice-join-btn"[^>]+aria-labelledby="([^"]+)"/)[1];
  assert.ok(html.includes('<span id="' + id + '" data-i18n="voice.join">'));
  assert.match(read('public/js/modules/app-calls.js'), /querySelector\('#voice-join-btn span'\)[\s\S]*?label.textContent = ch\?\.is_dm/);
});

test('at tablet width the Members drawer has a close button and the header owns voice join', () => {
  assert.match(media(layout, '(min-width: 769px) and (max-width: 900px)'), /#mobile-right-close \{ display: flex;/);
  assert.match(media(layout, '(min-width: 769px)'), /#voice-join-mobile \{ display: none;/);
});

test('Haven already fixes the full reaction panel to both phone viewport edges', () => {
  const imports = read('public/css/style.css');
  assert.ok(imports.indexOf('/css/style-admin-panels.css') > imports.indexOf('/css/style-mobile.css'));
  const phone = media(read('public/css/style-admin-panels.css'), '(max-width: 480px)');
  const panel = phone.match(/\.reaction-full-picker \{([^}]+)}/)[1];
  for (const rule of ['position: fixed', 'left: 8px', 'right: 8px', 'width: auto', 'max-width: none']) {
    assert.ok(panel.includes(rule + ' !important'), rule);
  }
  assert.match(read('public/js/modules/app-emoji-picker.js'), /document.body.appendChild\(panel\);\s*panel.style.position = 'fixed'/);
});

test('rotating from phone to tablet dismisses only a drawer that becomes permanent', async () => {
  const doc = makeDocument();
  const body = doc.createElement('div');
  body.id = 'app-body';
  doc.body.appendChild(body);
  for (const id of ['mobile-menu-btn', 'mobile-users-btn', 'mobile-overlay']) {
    const button = doc.createElement('button');
    button.id = id;
    body.appendChild(button);
  }
  const handlers = {};
  doc.addEventListener = (type, listener) => { handlers[type] = listener; };
  const left = { matches: true, addEventListener(_, fn) { this.changed = fn; } };
  const right = { ...left };
  globalThis.document = doc;
  globalThis.window = {
    innerWidth: 375,
    matchMedia(query) {
      if (query.includes('768px')) return left;
      if (query.includes('900px')) return right;
      return { matches: false };
    }
  };
  const app = { ...await mobileMethods(), switchChannel() {} };
  app._setupMobile();
  const swipe = (start, end) => {
    handlers.touchstart({ touches: [{ clientX: start, clientY: 50 }] });
    handlers.touchend({ changedTouches: [{ clientX: end, clientY: 50 }] });
  };
  const overlay = doc.getElementById('mobile-overlay');
  swipe(4, 140);
  assert.ok(overlay.classList.contains('active'));
  left.matches = false;
  window.innerWidth = 800;
  left.changed();
  assert.equal(overlay.classList.contains('active'), false);
  swipe(4, 140);
  assert.equal(overlay.classList.contains('active'), false);
  swipe(797, 620);
  assert.ok(body.classList.contains('mobile-right-open'));
  assert.ok(overlay.classList.contains('active'));
  right.matches = false;
  right.changed();
  assert.equal(overlay.classList.contains('active'), false);
});

test('tapping channel options is handled before the row can switch conversations', async () => {
  const row = { dataset: { code: 'room' }, closest: () => null };
  const button = { closest: selector => selector === '.channel-more-btn' ? button : row };
  let open;
  const list = { addEventListener(event, handler, capture) {
    assert.equal(event, 'click');
    assert.equal(capture, true);
    open = handler;
  } };
  globalThis.document = { getElementById: id => id === 'channel-list' ? list : null };
  const methods = await import(pathToFileURL(path.join(ROOT, 'public/js/modules/app-channel-context.js')).href);
  const calls = [];
  const app = { ...methods.default, _openChannelCtxMenu: (...args) => calls.push(args) };
  app._initChannelContextMenu();
  let stopped = false;
  const click = target => open({ target, stopPropagation() { stopped = true; } });
  click(row);
  assert.equal(stopped, false);
  click(button);
  assert.ok(stopped);
  assert.deepEqual(calls, [['room', button]]);
});
