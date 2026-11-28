'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { CSS } = require('../plugins/HabitatLayout.plugin.js');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const html = read('public/app.html');
const moduleMethods = (file, globals) => vm.runInNewContext(
  read('public/js/modules/' + file).replace('export default {', '({').replace(/};\s*$/, '})'), globals);

test('the upstream credit needs no donor markup, proxy buttons, startup request or DOM writers', () => {
  const removed = /\b(?:donors-(?:btn|modal|close-btn|sort-toggle|tiers|grid)|sponsors-grid)\b|_initDonorsModal|\/api\/donors/;
  assert.doesNotMatch(html, removed);
  for (const dir of ['public/js', 'plugins']) {
    for (const file of fs.readdirSync(path.join(root, dir), { recursive: true }).filter(p => p.endsWith('.js'))) {
      assert.doesNotMatch(read(path.join(dir, file)), removed, file);
    }
  }
  assert.match(html, /id="whats-new-version"><\/div>\s*<!--[\s\S]*?-->\s*<small[^>]*><a href="https:\/\/github.com\/ancsemi\/Haven"[^>]*><span data-i18n="settings.whats_new.built_on">Built on<\/span> Haven<\/a>/);
  assert.equal(JSON.parse(read('public/locales/en.json')).settings.whats_new.built_on, 'Built on');
});

test('the Settings footer switch and all live status fields survive removing its reveal tab', () => {
  assert.doesNotMatch(html, /id="status-bar-toggle"/);
  assert.doesNotMatch(read('plugins/HabitatLayout.plugin.js'), /status-bar-toggle/);
  assert.match(html, /id="section-debug"[\s\S]*?id="show-status-bar"/);
  const bar = html.slice(html.indexOf('id="status-bar"'), html.indexOf('id="online-overlay"'));
  for (const id of ['server-led', 'server-text', 'ping', 'channel', 'online-trigger', 'online-count',
    'url-item', 'url-text', 'url-toggle', 'clock', 'version']) assert.ok(bar.includes('id="status-' + id + '"'), id);
  const context = read('public/js/modules/app-context.js');
  assert.match(context, /showStatusBarToggle\.addEventListener\('change',[\s\S]*?applyStatusBar\(\)/);
  assert.match(context, /sb\.style\.setProperty\('display', 'flex', 'important'\)/);
});

test('an empty topic loses its strip in Habitat and a live topic brings it back', () => {
  const text = {}, attrs = new Set();
  const bar = { style: {}, querySelector: () => text, classList: { contains: () => false },
    toggleAttribute(name, on) { if (on) attrs.add(name); else attrs.delete(name); } };
  const app = moduleMethods('app-channels.js', { document: { getElementById: () => bar }, t: key => key });
  let edits = 0;
  Object.assign(app, { user: {}, _hasPerm: () => true, _setTopicBarFolded() {}, _editTopic: () => edits++ });
  assert.match(CSS, /html\[data-habitat-layout\] #channel-topic-bar\[data-empty-topic\][^{}]*\{ display: none; \}/);
  app._updateTopicBar('');
  assert.ok(attrs.has('data-empty-topic'));
  app._updateTopicBar('Friday at eight');
  assert.equal(text.textContent, 'Friday at eight');
  assert.equal(attrs.has('data-empty-topic'), false);
  bar.onclick();
  assert.equal(edits, 1);
  app._hasPerm = () => false;
  app._updateTopicBar('Read only');
  bar.onclick();
  assert.equal(edits, 1);
  app._updateTopicBar('');
  assert.ok(attrs.has('data-empty-topic'));
});

test('the Settings picker changes all preview sizes without a visible per-card button', () => {
  assert.match(CSS, /html\[data-habitat-layout\] \.lp-header \.lp-size \{ display: none; \}/);
  assert.match(html, /id="embed-size-picker"/);
  const classes = new Set(), storage = new Map();
  const picker = { addEventListener(type, cb) { this[type] = cb; }, querySelectorAll: () => [] };
  const app = moduleMethods('app-appearance.js', {
    document: { body: { classList: { add: c => classes.add(c), remove: (...cs) => cs.forEach(c => classes.delete(c)) } },
      getElementById: id => id === 'embed-size-picker' ? picker : null, querySelectorAll: () => [] },
    localStorage: { getItem: k => storage.get(k), setItem: (k, v) => storage.set(k, v) }, t: k => k
  });
  app._setupEmbedSizePicker();
  for (const mode of ['off', 'small', 'medium', 'full']) {
    picker.click({ target: { closest: () => ({ dataset: { embedSize: mode } }) } });
    assert.deepEqual([...classes], ['embed-size-' + mode]);
    assert.equal(app._embedSize(), mode);
  }
});

test('an explicit server choice restores capability badges while mute, privacy and unread stay visible', () => {
  const node = () => ({ children: [], dataset: {}, style: {}, querySelector: () => null,
    addEventListener() {}, setAttribute() {}, appendChild(child) { this.children.push(child); } });
  const list = node();
  const document = { createElement: node, getElementById: id => id === 'channel-list' ? list : null };
  const app = moduleMethods('app-channels.js', { document, t: k => k, setTimeout() {}, clearTimeout() {},
    localStorage: { getItem: k => k === 'haven_muted_channels' ? '["general"]' : null } });
  Object.assign(app, { channels: [{ id: 7, code: 'general', name: 'General', is_private: 1,
    streams_enabled: 0, music_enabled: 0 }], unreadCounts: { general: 2 }, _threadMentions: { general: [1] },
    _getHiddenChannels: () => [], _applyPersonalChannelOrder: rows => rows, _applyPersonalCategoryOrder: rows => rows,
    _escapeHtml: s => s, _hasPerm: () => false, _updateChannelVoiceIndicators() {},
    _setupChannelDragDrop() {}, _setupDmDragDrop() {}, _setupPersonalChannelOrder() {}, _decorateArrangeMode() {},
    _updateNestedIndicators() {} });
  for (const setting of [undefined, 'false', 'true']) {
    app.serverSettings = { hide_disabled_channel_badges: setting };
    app._renderChannels();
    const row = list.children.at(-1);
    for (const capability of ['screen_share_not_allowed', 'music_not_allowed']) {
      assert.equal(row.innerHTML.includes(capability), setting === 'false');
    }
    assert.match(row.className, /private-channel/);
    assert.match(row.innerHTML, /muted_unsubscribed/);
    assert.deepEqual(row.children.map(child => child.className), ['channel-badge', 'channel-badge thread-mention-badge']);
  }
});

test('Habitat reserves the channel header during boot and after the layout engages', () => {
  const css = read('public/css/style-sidebar.css');
  const selector = 'html:is([data-habitat-boot], [data-habitat-layout]) [data-haven-region="channel-header"]';
  const headers = css.split(selector).slice(1).map(part => part.split('}')[0]);
  assert.match(headers[0], /box-sizing: border-box; height: 3\.8125rem; flex: none/);
  assert.match(headers[2], /flex-wrap: nowrap; overflow: hidden;/);
  assert.match(CSS, /\.channel-header:has\(details\[open\]\).*overflow: visible/);
  assert.match(headers[1], /height: calc\(3\.25rem \+ var\(--safe-top/);
});

test('Sound Manager fits short tabs and scrolls long ones inside the resizable modal', () => {
  const modal = html.match(/id="sound-modal"[^>]*>\s*(?:<!--[\s\S]*?-->\s*)?(<div[^>]*>)/)[1];
  assert.doesNotMatch(modal, /(?:min-)?height:/);
  assert.match(modal, /class="modal modal-flex"/);
  const theme = read('themes/habitat-grafit.theme.css');
  assert.match(theme, /#sound-modal \.sound-tab-content\s*\{[^}]*min-height: 0; overflow-y: auto/);
  assert.match(theme, /#sound-modal \.modal\s*\{[^}]*max-height: 85dvh/);
  assert.doesNotMatch(theme, /#sound-modal [^{}]*\{[^{}]*resize: none/);
});

test('static boot placeholders paint without adding a box to the shell layout', () => {
  const css = read('public/css/style-sidebar.css');
  const boot = css.slice(css.indexOf('/* Habitat fork: paint in the reserved shell'), css.indexOf('/* ── Left Sidebar'));
  const rules = [...boot.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  const paint = rules.filter(([, selector]) => /::(before|after)/.test(selector));
  for (const [, selectors] of paint) {
    for (const selector of selectors.trim().split(/,\s*(?=html)/)) assert.match(selector, /^html\[data-habitat-boot[=\]]/);
  }
  const [, boxes, declarations] = paint.find(([, , body]) => body.includes('content:'));
  for (const region of ['welcome', 'message-area', 'channel-header', 'navigation-sidebar']) assert.ok(boxes.includes(region));
  assert.match(declarations, /position: absolute/);
  assert.match(declarations, /pointer-events: none/);
  assert.equal((boot.match(/var\(--boot-face\) left (?:top|[48]rem)/g) || []).length, 3);
  assert.match(boot, /@media \(min-width: 901px\) \{\s*html\[data-habitat-boot="desktop"\]/);
  assert.doesNotMatch(boot, /animation:|transition:|infinite/);
});
