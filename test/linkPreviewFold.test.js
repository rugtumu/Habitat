'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ROOT = path.join(__dirname, '..');
const load = (name, globals) => {
  const context = vm.createContext({ module: { exports: {} }, exports: {}, ...globals });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'public/js/modules', name), 'utf8').replace(/^export default/m, 'module.exports ='), context, { filename: name });
  return context.module.exports;
};
const globals = {
  document: { createElement: () => ({ className: '', dataset: {}, style: { setProperty() {} }, set innerHTML(v) {}, querySelector: () => null }), body: { className: 'embed-size-medium' } },
  window: { location: { origin: 'https://haven.test' } },
  CSS: { escape: s => s },
  t: k => k,
  Promise,
};
const methods = load('app-link-previews.js', globals);
const view = (over = {}) => Object.assign(Object.create(methods), {
  _collapsedEmbeds: new Set(),
  _openedEmbeds: new Set(),
  _applyEmbedSize() {},
  _embedSize: () => 'medium',
  _extractYouTubeVideoId: () => null,
  _linkPreviewData: async url => ({ title: url, siteName: 'Site' }),
  _embedHeaderHtml: () => '',
  _wireEmbedControls() {},
  _applyEmbedSpoiler() {},
  _escapeHtml: s => s,
  _imgSrcAttr: () => '',
  _cnt: () => null,
}, over);
const message = urls => {
  const cards = [];
  const host = { querySelector: () => null, querySelectorAll: () => cards, appendChild: card => cards.push(card) };
  const links = urls.map(href => ({ href, dataset: {}, closest: () => host }));
  return { cards, container: { querySelectorAll: () => links } };
};
const settle = () => new Promise(resolve => setImmediate(resolve));
test('the third link preview in a message starts folded, the first two stay open', async () => {
  const m = message(['https://a.test/1', 'https://b.test/2', 'https://c.test/3', 'https://d.test/4']);
  view()._fetchLinkPreviews(m.container);
  await settle();
  assert.deepEqual(m.cards.map(c => c.className.includes('lp-collapsed')), [false, false, true, true]);
});
test('a folded extra card stays open once it was opened by hand', async () => {
  const m = message(['https://a.test/1', 'https://b.test/2', 'https://c.test/3']);
  view({ _openedEmbeds: new Set(['https://c.test/3']) })._fetchLinkPreviews(m.container);
  await settle();
  assert.deepEqual(m.cards.map(c => c.className.includes('lp-collapsed')), [false, false, false]);
});
test('Start link previews folded folds every card until it is opened', async () => {
  const m = message(['https://a.test/1', 'https://b.test/2']);
  view({ _previewsStartFolded: () => true, _openedEmbeds: new Set(['https://b.test/2']) })._fetchLinkPreviews(m.container);
  await settle();
  assert.deepEqual(m.cards.map(c => c.className.includes('lp-collapsed')), [true, false]);
});
test('a card folded by hand stays folded whatever the settings say', () => {
  assert.equal(view({ _collapsedEmbeds: new Set(['u']), _openedEmbeds: new Set(['u']) })._embedFolded('u'), true);
  assert.equal(view()._embedFolded('u'), false);
});

test('bottom-coupled history reserves a single slot before metadata and keeps the image inside it', async () => {
  const css = fs.readFileSync(path.join(ROOT, 'public/css/style-profile-servers-modals.css'), 'utf8');
  const rules = selector => css.split(selector + ' {').at(-1).split('}')[0];
  assert.match(rules('.embed-size-small .link-preview--rich .lp-media'), /max-height: 10rem/);
  assert.match(css, /\.link-preview--rich \.lp-media\s*\{\s*width: 100%; aspect-ratio: var\(--lp-image-ratio, 16 \/ 9\); max-height: 32\.5rem/);
  assert.match(css, /\.embed-size-medium \.link-preview--rich \.lp-media \{ max-height: 18\.75rem/);
  assert.match(rules('.link-preview--rich .lp-media > .lp-image'), /position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain/);
  const host = { isConnected: true, card: null, closest: () => ({ dataset: { msgId: 42 } }), querySelector() { return this.card; },
    querySelectorAll() { return this.card ? [this.card] : []; }, appendChild(card) { this.card = card; } };
  const dom = { ...globals.document, createElement: () => ({
    dataset: {}, style: { setProperty(k, v) { this[k] = v; } }, setAttribute(k, v) { this[k] = v; },
    replaceWith(card) { assert.equal(host.card, this); host.card = card; }, remove() { host.card = null; }
  }) };
  const m = load('app-link-previews.js', { ...globals, document: dom });
  const link = { href: 'https://example.test/link', dataset: {}, closest: () => host };
  const container = { id: 'messages', querySelectorAll: () => [link] };
  let finish, scrolls = 0, requests = 0;
  const app = view({ _fetchLinkPreviews: m._fetchLinkPreviews, _restoredPreviewHeights: () => ({ '42/0/false': 20 }), _coupledToBottom: true, _scrollToBottom: () => scrolls++,
    _linkPreviewData() { requests++; return new Promise(resolve => { finish = resolve; }); } });
  app._fetchLinkPreviews(container);
  assert.match(host.card.className, /lp-pending/);
  assert.equal(host.card.style.height, '20rem');
  assert.equal(host.card['aria-hidden'], 'true');
  assert.equal(scrolls, 1);
  app._fetchLinkPreviews(container);
  assert.equal(requests, 1);
  finish({ title: 'Picture', image: 'a.jpg', imageWidth: 800, imageHeight: 600 });
  await settle();
  assert.doesNotMatch(host.card.className, /lp-pending/);
  assert.match(host.card.innerHTML, /class="lp-image".*loading="lazy"/);
  assert.equal(host.card.style['--lp-image-ratio'], '800 / 600');
  assert.equal(scrolls, 2);
  host.card = null;
  app._fetchLinkPreviews(container);
  app._coupledToBottom = false;
  finish(null);
  await settle();
  assert.equal(host.card, null);
  assert.equal(scrolls, 3, 'a failed preview releases its space without scrolling the reader back');
  app._coupledToBottom = true;
  app._restoredPreviewHeights = () => ({ '42/0/false': 20 });
  app._fetchLinkPreviews(container);
  assert.equal(host.card.style.height, '20rem', 'a reload reserves the entire measured card before metadata');
  app._coupledToBottom = false;
  finish({ title: 'Picture', image: 'a.jpg' });
  await settle();
  assert.equal(scrolls, 4, 'successful metadata also respects someone who has scrolled away');
  assert.equal(host.card.style['--lp-image-ratio'], undefined, 'no dimensions uses the CSS fallback');
  app._coupledToBottom = true;
  for (const heights of [null, {}, { '42/1/false': 20 }, { '43/0/false': 20 }]) {
    host.card = null;
    app._restoredPreviewHeights = () => heights;
    app._fetchLinkPreviews(container);
    assert.equal(host.card, null, 'an unmeasured link takes no space while pending');
    finish({ title: 'Article' });
    await settle();
    assert.match(host.card.innerHTML, /Article/);
  }
});

test('a restored feed reuses measured card heights only for the same conversation and size', () => {
  const stored = new Map(), events = new Map();
  const methods = load('app-link-previews.js', { ...globals, document: { documentElement: { lang: 'en' } },
    getComputedStyle: () => ({ fontSize: '16px' }),
    sessionStorage: { getItem: key => stored.get(key) ?? null, setItem: (key, data) => stored.set(key, data) },
    window: { addEventListener: (name, cb) => events.set(name, cb) } });
  const app = () => Object.assign(Object.create(methods), { currentChannel: 'room', channels: [{ id: 21, code: 'room' }], user: { id: 1 }, _embedSize: () => 'medium' });
  const list = { clientWidth: 900, querySelectorAll: () => [{ offsetHeight: 320, dataset: { previewSlot: 0 },
    closest: () => ({ dataset: { msgId: 42 } }), classList: { contains: () => false } }] };
  assert.equal(app()._restoredPreviewHeights(list), null);
  events.get('pagehide')();
  const restored = app();
  assert.equal(restored._restoredPreviewHeights(list)['42/0/false'], 20);
  list.clientWidth = 375;
  assert.equal(restored._restoredPreviewHeights(list), null);
  list.clientWidth = 900;
  restored.currentChannel = 'another room';
  assert.equal(restored._restoredPreviewHeights(list), null);
});
