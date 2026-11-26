'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

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
