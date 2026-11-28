'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { makeDocument, parseHtml } = require('./fakeDom');
const { CSS: layout } = require('../plugins/HabitatLayout.plugin');
const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const english = JSON.parse(read('public/locales/en.json'));
const t = key => key.split('.').reduce((v, part) => v?.[part], english) ?? key;

function page() {
  const doc = makeDocument();
  const create = doc.createElement;
  function build(node) {
    if ('text' in node) return doc.createTextNode(node.text);
    const el = doc.createElement(node.tag);
    for (const [key, value] of Object.entries(node.attrs)) el.setAttribute(key, value);
    el.append(...node.children.map(build));
    return el;
  }
  doc.createElement = tag => {
    const el = create(tag);
    Object.defineProperty(el, 'innerHTML', { set(html) { el.replaceChildren(...parseHtml(html).map(build)); } });
    el.getClientRects = () => el.hidden || el.style.display === 'none' ? [] : [{}];
    el.scrollIntoView = options => { el.scrolled = options.block; };
    el.style.setProperty = (key, value) => { el.style[key] = value; };
    el.dispatchEvent = ev => el.dispatch(ev.type);
    el.contains = node => node === el || el.children.some(child => child.contains(node));
    return el;
  };
  doc.body = doc.createElement('body');
  doc.querySelectorAll = s => doc.body.querySelectorAll(s);
  doc.querySelector = s => doc.body.querySelector(s);
  return doc;
}

function load(doc, files, globals = {}) {
  const app = {};
  for (const name of files) {
    const source = read('public/js/modules/app-' + name + '.js').replace(/^import .*;$/mg, '');
    Object.assign(app, vm.runInNewContext(source.replace('export default {', '({').replace(/};\s*$/, '})'),
      { document: doc, t, setTimeout() {}, clearTimeout() {}, Event, CustomEvent, ...globals }));
  }
  app._escapeHtml = text => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
  return app;
}

test('switcher groups searchable plain names, skips hidden rows and moves selection past headings', () => {
  const doc = page();
  const app = load(doc, ['channels']);
  const rooms = [
    { code: 'dm', is_dm: 1, dm_target: { id: 5, username: 'kim' }, unreadCount: 104 },
    { code: 'voice', voice_enabled: 1, text_enabled: 0, media_enabled: 0, unreadCount: 4 },
    { code: 'text', unreadCount: 5 }, { code: 'temp', is_temp_voice: 1 },
    { code: 'disabled', is_temp_voice: 1, voice_enabled: 0, unreadCount: 9 },
    { code: 'group', is_dm: 1, is_group: 1 }, { code: 'hidden', id: 99 },
    { code: 'orphan', parent_channel_id: 99 }, { code: 'nsfw', is_nsfw: 1 },
    { code: 'active', is_nsfw: 1 }, { code: 'sub', parent_channel_id: 3 },
  ];
  Object.assign(app, {
    channels: rooms.map((ch, i) => ({ id: i + 1, name: ch.code, ...ch })),
    currentChannel: 'active', _getHiddenChannels: () => ['hidden', 'active'], _hideNsfw: () => true,
    unreadCounts: { disabled: 0 }, _mentionCountFor: code => code === 'voice' ? 2 : 0,
    _groupName: () => 'Friends', _getNickname: () => 'Kimi', switchChannel(code) { this.picked = code; },
  });
  app._openQuickSwitcher();
  const results = doc.getElementById('quick-switcher-results');
  const input = doc.getElementById('quick-switcher-input');
  const rows = () => results.querySelectorAll('.quick-switcher-item');
  const byCode = code => rows().find(el => el.dataset.code === code);
  assert.deepEqual(results.querySelectorAll('.qs-group').map(el => el.textContent), ['Channels', 'Voice rooms', 'Direct messages']);
  assert.deepEqual(rows().map(el => el.dataset.kind), ['text', 'text', 'text', 'text', 'voice', 'voice', 'dm', 'dm']);
  for (const code of ['hidden', 'orphan', 'nsfw']) assert.equal(byCode(code), undefined);
  assert.ok(byCode('active') && byCode('sub'));
  assert.equal(byCode('dm').querySelector('.qs-badge').textContent, '99+');
  assert.equal(byCode('dm').querySelector('.qs-name').textContent, 'Kimi');
  assert.equal(byCode('group').querySelector('.qs-icon').textContent, '@');
  assert.equal(byCode('voice').querySelector('.qs-badge').textContent, '2');
  assert.equal(byCode('temp').querySelector('.qs-icon').textContent, '🔊');
  assert.ok(byCode('text').querySelector('.qs-unread'));
  assert.equal(byCode('disabled').querySelector('.qs-unread'), null);
  for (const value of ['#', '@', '👥', 'missing']) {
    input.value = value;
    input.dispatch('input');
    assert.equal(rows().length, 0);
    assert.equal(results.children.length, 1);
    assert.equal(results.querySelector('[role="status"]').textContent, 'No conversations match');
    input.dispatch('keydown', { key: 'Enter' });
    assert.equal(app.picked, undefined);
  }
  input.value = 'friends'; input.dispatch('input');
  assert.equal(rows()[0].dataset.code, 'group');
  input.value = ''; input.dispatch('input');
  for (let i = 1; i < rows().length; i++) input.dispatch('keydown', { key: 'ArrowDown' });
  const last = rows().at(-1);
  assert.equal(last.scrolled, 'nearest');
  assert.deepEqual(results.querySelectorAll('.selected'), [last]);
  input.dispatch('keydown', { key: 'Enter' });
  assert.equal(app.picked, last.dataset.code);
  assert.equal(doc.getElementById('quick-switcher-overlay'), null);
});

test('one Escape dismisses one surface in order and settles just the selected dialog', async () => {
  const doc = page();
  doc.body.innerHTML = '<div id="settings" class="modal-overlay"></div><div id="image-lightbox"></div>';
  const app = load(doc, ['ui', 'utilities', 'media']);
  app._hideImageContextMenu = () => {};
  const settings = doc.getElementById('settings');
  const lightbox = doc.getElementById('image-lightbox');
  let dismissals = 0, reads = 0;
  settings.addEventListener('modal-dismiss', () => {
    assert.equal(settings.style.display, 'none');
    dismissals++;
  });
  app._markAllRead = () => reads++;
  app.socket = { connected: true };
  let laterHandlers = 0;
  app._bindEscapeShortcuts();
  doc.addEventListener('keydown', () => laterHandlers++);
  const escape = (mods = {}) => {
    const e = { key: 'Escape', target: doc.activeElement || doc.body, preventDefault() { this.prevented = true; },
      stopImmediatePropagation() { this.stopped = true; }, ...mods };
    for (const fn of doc.listeners.keydown) { fn(e); if (e.stopped) break; }
    return e;
  };
  const answer = app._showConfirmModal('Confirm', 'Continue?');
  const switcher = doc.createElement('div');
  switcher.id = 'quick-switcher-overlay';
  doc.body.appendChild(switcher);
  assert.ok(escape({ shiftKey: true }).prevented);
  assert.equal(reads, 1);
  assert.equal(switcher.parentNode, doc.body);
  escape();
  assert.equal(switcher.parentNode, null);
  assert.notEqual(lightbox.style.display, 'none');
  escape();
  assert.equal(lightbox.style.display, 'none');
  assert.ok(doc.getElementById('confirm-modal-ok'));
  escape();
  assert.equal(await answer, false);
  assert.equal(doc.getElementById('confirm-modal-ok'), null);
  for (const promise of [() => app._askChoice('Choose', '', [{ id: 'x', label: 'X' }]),
    () => app._showPromptModal('Name', '')]) {
    const pending = promise(); escape(); assert.equal(await pending, null);
  }
  assert.equal(dismissals, 0);
  escape();
  assert.equal(dismissals, 1);
  assert.equal(laterHandlers, 0);
  for (const mod of ['ctrlKey', 'metaKey', 'altKey']) escape({ shiftKey: true, [mod]: true });
  assert.equal(laterHandlers, 3);
  assert.equal(reads, 1);
  assert.doesNotThrow(() => escape());
});

test('Escape steps through context, reaction, theme, search and thread before jumping', () => {
  const doc = page();
  doc.body.innerHTML = '<div id="message-area"></div><div id="thread-panel"></div><div id="search-container"></div>' +
    '<div id="theme-popup"></div><div class="reaction-picker"></div><div class="reaction-full-picker"></div>' +
    '<div id="channel-ctx-menu" class="channel-ctx-menu"></div>';
  const app = load(doc, ['ui', 'channel-context', 'search', 'emoji-picker']);
  Object.assign(app, {
    currentChannel: 'a', _ctxMenuEl: doc.getElementById('channel-ctx-menu'), _searchSeq: 3,
    _searchState: { __public__: { open: true } }, _closeThread() { doc.getElementById('thread-panel').remove(); },
    _jumpToLatest() { this.jumped = true; },
  });
  app._bindEscapeShortcuts();
  const key = () => doc.listeners.keydown[0]({ key: 'Escape', preventDefault() {}, stopImmediatePropagation() {} });
  key(); assert.equal(app._ctxMenuEl.style.display, 'none');
  assert.ok(doc.querySelector('.reaction-full-picker'));
  key(); assert.equal(doc.querySelector('.reaction-full-picker'), null);
  assert.ok(doc.querySelector('.reaction-picker'));
  key(); assert.equal(doc.querySelector('.reaction-picker'), null);
  assert.notEqual(doc.getElementById('theme-popup').style.display, 'none');
  key(); assert.equal(doc.getElementById('theme-popup').style.display, 'none');
  assert.ok(app._searchState.__public__.open);
  key(); assert.equal(app._searchState.__public__, undefined);
  assert.equal(app._searchSeq, 4, 'late results from the closed search will be ignored');
  assert.equal(doc.getElementById('search-container').style.display, 'none');
  assert.ok(doc.getElementById('thread-panel'));
  key(); assert.equal(doc.getElementById('thread-panel'), null); assert.equal(app.jumped, undefined);
  key(); assert.equal(app.jumped, true);
});

test('bulk read waits for success then clears and persists all mention indicators', () => {
  const doc = page(), saved = new Map();
  const localStorage = { setItem: (k, v) => saved.set(k, v), getItem: k => saved.get(k) };
  const app = load(doc, ['channel-context', 'mentions', 'threads'], { localStorage });
  let redraws = 0, reply;
  const events = [];
  Object.assign(app, {
    channels: [{ code: 'a', unreadCount: 2, latestMessageId: 23 }], unreadCounts: { a: 2, dm: 3 },
    _channelMentionIds: { a: new Set([22]) }, _unseenMentions: [{ c: 'a', id: 22 }],
    _threadMentions: { a: [{ parentId: 4 }] }, forumUnread: { f: 1 },
    _showToast() {}, _updateTabTitle() {}, _updateDesktopBadge() {}, _renderChannels() { redraws++; },
    socket: { emit(event, data, cb) { events.push(event); if (cb) reply = cb; } },
  });
  app._markAllRead(); reply({ error: 'offline' });
  assert.equal(app._unseenMentions.length, 1); assert.equal(redraws, 0);
  app._markAllRead(); reply({ ok: true });
  assert.deepEqual(Object.keys(app._channelMentionIds), []);
  assert.equal(app._unseenMentions.length, 0); assert.deepEqual(Object.keys(app._threadMentions), []);
  assert.equal(saved.get('haven_unseen_mentions'), '[]');
  assert.equal(saved.get('haven_mentions_seen_upto'), '23');
  assert.equal(saved.get('haven_thread_mentions'), '{}');
  assert.deepEqual(app.unreadCounts, { a: 0, dm: 0 });
  assert.equal(app.channels[0].unreadCount, 0); assert.equal(redraws, 1);
  assert.deepEqual(events, ['mark-all-read', 'mark-all-read', 'mark-forum-read']);
});

test('toast routing, deadlines, overlapping pause reasons and newest-only dedupe', () => {
  const doc = page();
  const timers = new Map();
  let now = 0, seq = 0;
  const app = load(doc, ['utilities'], {
    Date: { now: () => now },
    setTimeout(fn, ms) { timers.set(++seq, { due: now + ms, fn }); return seq; },
    clearTimeout(id) { timers.delete(id); },
  });
  const tick = ms => {
    now += ms;
    for (const [id, timer] of timers) if (timer.due <= now) { timers.delete(id); timer.fn(); }
  };
  app._showToast('no container');
  const markup = read('public/app.html').match(/<div id="toast-container">.*?<\/div><\/div>/s)[0];
  doc.body.innerHTML = markup;
  const wrapper = doc.getElementById('toast-container');
  const [status, alert] = wrapper.children;
  assert.equal(wrapper.getAttribute('role'), null);
  assert.deepEqual(wrapper.children.map(el => el.getAttribute('role')), ['status', 'alert']);
  for (const [type, duration] of [['success', 2500], ['info', 4000], ['warning', 6000], ['error', 7000]]) {
    app._showToast('notice', type);
    const region = type === 'error' ? alert : status;
    assert.equal(region.children[0].style['--toast-exit-delay'], duration - 300 + 'ms');
    tick(duration - 1); assert.equal(region.children.length, 1);
    tick(1); assert.equal(region.children.length, 0);
  }
  app._showToast('legacy', 'error', 6000);
  const error = alert.children[0];
  assert.equal(error.querySelector('button'), null);
  tick(1000); error.dispatch('mouseenter'); tick(6500);
  error.dispatch('focusin'); error.dispatch('mouseleave');
  assert.equal(error.style.animationPlayState, 'running, paused');
  assert.equal(alert.children.length, 1);
  error.dispatch('focusout', { relatedTarget: null }); tick(4999);
  assert.equal(alert.children.length, 1); tick(1); assert.equal(alert.children.length, 0);
  let clicked;
  const action = onClick => ({ label: 'Reply', onClick });
  app._showToast('call', 'info', action(() => { clicked = 'old'; }), 1000);
  const call = status.children[0], btn = call.querySelector('button');
  assert.equal(call.style['--toast-exit-delay'], '7700ms');
  const exit = { animationName: 'toastOut', currentTime: 5000 };
  call.isConnected = true;
  call.getAnimations = () => [exit];
  tick(5000); call.dispatch('focusin');
  app._showToast('call', 'info', action(() => { clicked = 'new'; }));
  assert.equal(status.children.length, 1); assert.equal(call.querySelector('button'), btn);
  assert.equal(exit.currentTime, 0);
  tick(9000); assert.equal(status.children.length, 1);
  call.dispatch('focusout', { relatedTarget: btn }); tick(9000);
  assert.equal(call.style.animationPlayState, 'running, paused');
  call.dispatch('focusout', { relatedTarget: null }); tick(7999);
  assert.equal(status.children.length, 1);
  btn.dispatch('click'); assert.equal(clicked, 'new'); assert.equal(status.children.length, 0);
  app._showToast('same', 'info'); app._showToast('same', 'error'); app._showToast('same', 'info');
  assert.equal(status.children.length, 2); assert.equal(alert.children.length, 1);
  tick(3000); app._showToast('same', 'info'); tick(1000); assert.equal(status.children.length, 1);
  tick(3000); assert.equal(status.children.length, 0);
});

test('Grafit keeps private text upright with a lock and caps the opaque phone banner in layout CSS', () => {
  const theme = read('themes/habitat-grafit.theme.css');
  assert.match(theme, /\.channel-item\.private-channel \.channel-name\s*\{[^}]*opacity: 1;[^}]*font-style: normal;/);
  assert.match(theme, /\.private-channel:not\(\.sub-channel-item, \.dm-item\) > \.channel-hash \{[^}]*mask: var\(--hb-icon-lock\)/);
  assert.match(theme, /\.private-channel\[data-habitat-voice-room\][^{]*\.channel-hash \{\s*mask-image: var\(--hb-icon-voice\)/);
  assert.match(theme, /\.channel-hash > \.haven-glyph \{ display: none;/);
  assert.match(theme, /@media \(pointer: coarse\) \{\s*[^{}]*\.toast-action-btn \{ min-height: 2\.75rem;/);
  assert.match(layout, /@media \(max-width: 768px\) \{\s*\/\*[^*]*\*\/\s*html\[data-habitat-layout\] \.main\.has-banner:not\(\.banner-mode-shaded\):not\(\.banner-mode-minimal\):not\(\.banner-mode-transparent\) > #server-banner-display \{\s*max-height: 3\.25rem;\s*\}/);
});

test('Escape leaves self-clearing fields alone and Shift+Escape is not fired by typing, repeats or offline', () => {
  const ui = read('public/js/modules/app-ui.js');
  const handler = ui.slice(ui.indexOf('_bindEscapeShortcuts() {'), ui.indexOf('_bindAppChrome() {'));
  const shift = handler.slice(handler.indexOf('if (e.shiftKey)'), handler.indexOf('this._markAllRead()'));
  assert.match(shift, /e\.repeat/);
  assert.match(shift, /closest\?\.\('input, textarea, select, \[contenteditable\]'\)/);
  assert.match(shift, /!this\.socket\?\.connected/);
  const own = handler.indexOf("field?.id === 'settings-search' || field?.id === 'user-search'");
  assert.ok(own > 0, 'the two search fields keep Escape while they hold text');
  assert.ok(handler.indexOf('.bitrate-value, .cfn-input-wrap') > own);
  assert.ok(own < handler.indexOf('if (dismiss(leading, e)) return;'), 'the fields are asked before any surface is closed');
});

test('the open search filters are not clipped by the fixed header', () => {
  const css = read('public/css/style-tags-uploads-search.css');
  assert.match(css, /html\[data-habitat-layout\] \.channel-header:has\(#search-filter-popover\[style\*="flex"\]\) \{ overflow: visible; z-index: 65; \}/);
});
