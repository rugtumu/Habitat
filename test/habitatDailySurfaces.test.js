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

function menuGroups(menu, name = el => el.dataset.action) {
  const groups = [[]];
  for (const el of menu.children) {
    if (el.tagName === 'hr' || el.classList.contains('user-ctx-divider')) groups.push([]);
    else if (el.tagName === 'button') groups.at(-1).push(name(el));
    else if (el.classList.contains('user-ctx-submenu-wrapper')) groups.at(-1).push(name(el.querySelector('button')));
  }
  return groups.map(group => group.join(' '));
}

// These inventories come from the pre-redesign menu builders at HEAD, including alternate states.
test('channel and DM groups retain every original action in source and keyboard order', () => {
  const html = read('public/app.html');
  for (const [id, expected] of [
    ['channel-ctx-menu', ['mark-read mark-all-read mute copy-channel-link join-voice leave-voice',
      'hide-channel rename-channel create-sub-channel organize move-to-parent promote-channel',
      'add-members channel-type channel-functions channel-roles webhooks merge-channel leave-channel delete']],
    ['dm-ctx-menu', ['dm-mark-read mark-all-read dm-mute', 'dm-pin',
      'dm-group-add dm-group-leave dm-group-delete dm-group-delete-all dm-delete']],
  ]) {
    const doc = page();
    const source = html.slice(html.indexOf('<div id="' + id + '"'));
    doc.body.innerHTML = source.slice(0, source.indexOf('\n  </div>') + 9);
    assert.deepEqual(menuGroups(doc.body.children[0]), expected, id);
  }
});

test('the message popup groups permitted actions and renders the inverse of each active toggle', () => {
  const doc = page();
  const app = load(doc, ['message-tools', 'message-nsfw']);
  const msg = doc.createElement('div');
  Object.assign(msg.dataset, { msgId: '12', userId: '1' });
  msg.innerHTML = '<div class="role-menu-widget"></div>';
  Object.assign(app, { user: { isAdmin: true, id: 1 }, _canShareChannelLink: () => true,
    _getMessageAttachments: () => ['file'], _canHighlightMessages: () => true, _fitCtxMenu() {}, _focusContextMenu() {} });
  const link = { href: 'https://example.org', closest() { return this; } };
  const open = () => {
    app._showMessageContextMenu({ target: link, clientX: 0, clientY: 0 }, msg);
    return doc.getElementById('message-context-menu');
  };
  assert.deepEqual(menuGroups(open()), ['copy-href reply quote react edit copy-link',
    'pin thread edit-tags select-messages', 'archive edit-role-menu nsfw highlight-on delete']);
  Object.assign(msg.dataset, { pinned: '1', archived: '1', highlighted: '1', nsfw: '1' });
  const menu = open();
  assert.deepEqual(menuGroups(menu), ['copy-href reply quote react copy-link',
    'unpin thread edit-tags select-messages', 'unarchive edit-role-menu unnsfw highlight-off']);
  assert.deepEqual(menu.querySelectorAll('[aria-checked="true"]').map(el => el.dataset.action), ['unpin', 'unarchive', 'unnsfw', 'highlight-off']);
});

test('member right-click and the gear build the same groups, including the self and group-owner actions', () => {
  const doc = page();
  const app = load(doc, ['context', 'users', 'groups'], { t: key => key });
  const anchor = { closest: () => null, getBoundingClientRect: () => ({ left: 0, bottom: 0 }) };
  Object.assign(app, { user: { isAdmin: true, id: 1 }, currentChannel: 'g',
    channels: [{ name: 'General' }, { code: 'g', is_group: 1, is_dm: 1, created_by: 1, group_members: [{ id: 2 }] }],
    serverSettings: { admin_password_reset_enabled: 'true' }, _canManageBadges: () => true, _hasPerm: () => true,
    _closeProfilePopup() {}, _placeUserContextMenu(menu) { this.groups = menuGroups(menu, btn => btn.textContent.match(/[a-z][\w.]+/)[0]); } });
  const expected = ['context.view_profile users.direct_message mute.mute_member users.set_nickname',
    'context.invite_to_channel users.gear_menu.add_to_channel', 'users.gear_menu.role_management badges.menu',
    'mod_cases.history users.gear_menu.unmute mod_cases.warn users.gear_menu.kick users.gear_menu.mute users.gear_menu.ban users.gear_menu.delete_user users.gear_menu.reset_password',
    'groups.remove_member'];
  app._showUserContextMenu({ target: anchor }, 2, 'Member');
  assert.deepEqual(app.groups, expected);
  app._openUserMenuFromButton(anchor, 2, 'Member');
  assert.deepEqual(app.groups, expected);
  app._openUserMenuFromButton(anchor, 1, 'Self');
  assert.deepEqual(app.groups, ['context.view_profile', 'users.gear_menu.role_management badges.menu']);
});

test('context keys wrap past hidden items, match the next label and restore the opener on Escape', () => {
  const doc = page();
  const app = load(doc, ['channel-context', 'ui']);
  doc.body.innerHTML = '<button id="opener"></button><div class="channel-ctx-menu" id="dm-ctx-menu">' +
    '<button>✅ Mark read</button><hr class="channel-ctx-sep"><button>Mute</button><button>Pin</button><button>Delete</button></div>';
  const menu = doc.getElementById('dm-ctx-menu'), opener = doc.getElementById('opener');
  const buttons = menu.querySelectorAll('button');
  buttons[2].style.display = 'none';
  for (const el of menu.children) el.matches = selector => selector.split(', ').some(part => el._matches(part));
  let clicks = 0;
  for (const btn of buttons) {
    btn.closest = () => null;
    btn.click = () => clicks++;
    btn.insertBefore = (node, before) => btn.childNodes.splice(btn.childNodes.indexOf(before), 0, node);
  }
  opener.isConnected = true;
  app._dmCtxMenuEl = menu;
  app._focusContextMenu(menu, opener);
  app._bindEscapeShortcuts();
  assert.equal(doc.activeElement, buttons[0]);
  for (const [key, index] of [['m', 1], ['M', 0], ['ArrowUp', 3], ['Home', 0], ['End', 3], ['ArrowDown', 0]]) {
    menu.onkeydown({ key, target: doc.activeElement, preventDefault() {}, stopPropagation() {} });
    assert.equal(doc.activeElement, buttons[index], key);
  }
  for (const key of ['Enter', ' ']) menu.onkeydown({ key, target: doc.activeElement, preventDefault() {}, stopPropagation() {} });
  assert.equal(clicks, 2);
  doc.listeners.keydown[0]({ key: 'Escape', preventDefault() {}, stopImmediatePropagation() {} });
  assert.equal(menu.style.display, 'none');
  assert.equal(doc.activeElement, opener);
});

test('only the open profile and requesting connection can turn a DM reply into a call', async () => {
  const doc = page();
  doc.documentElement = { hasAttribute: () => true };
  doc.body.innerHTML = '<div id="profile-popup" data-habitat-avatar-id="9"><button data-habitat-profile-action="call" data-call-socket="tab"></button></div>';
  const card = doc.getElementById('profile-popup');
  const app = load(doc, ['socket-events', 'calls']);
  const events = new Map(), calls = [];
  Object.assign(app, { socket: { id: 'tab', on: (key, fn) => events.set(key, fn) }, channels: [],
    _renderChannels() {}, _fetchDMPartnerKey() {}, _dmOpensInMain: () => true,
    switchChannel(code) { this.currentChannel = code; }, _joinVoice(code) { calls.push(code); },
    _closeProfilePopup() { card.remove(); } });
  app._listenFeatureEvents();
  const opened = (id, incoming = false) => events.get('dm-opened')({ code: 'dm-' + id, is_dm: 1, dm_target: { id } }, incoming);
  opened(9, true);
  opened(8);
  app.socket.id = 'reconnected';
  opened(9);
  assert.deepEqual(calls, []);
  app.socket.id = 'tab';
  opened(9);
  await Promise.resolve();
  assert.deepEqual(calls, ['dm-9']);
  opened(9);
  await Promise.resolve();
  assert.deepEqual(calls, ['dm-9']);
});

test('a timeout does not block direct messages and an early unmute lifts the block', () => {
  const channels = read('public/js/modules/app-channels.js');
  assert.match(channels, /const timedOut = timeout\?\.style\.display === 'flex' && !channel\?\.is_dm;/);
  const events = read('public/js/modules/app-socket-events.js');
  const unmuted = events.slice(events.indexOf("this.socket.on('unmuted'"), events.indexOf("this.socket.on('ban-list'"));
  assert.match(unmuted, /clearTimeout\(this\._timeoutNoticeTimer\)/);
  assert.match(unmuted, /bar\.style\.display = 'none'/);
  assert.match(unmuted, /_updateComposerVisibility/);
});

test('a link preview is not sized from the lazy loader\'s blank image', () => {
  const previews = read('public/js/modules/app-link-previews.js');
  const decoded = previews.slice(previews.indexOf('const decoded = () => {'), previews.indexOf("image.addEventListener('load', decoded)"));
  assert.ok(decoded.indexOf('this._lazyBlank?.()') > 0 && decoded.indexOf('this._lazyBlank?.()') < decoded.indexOf('sizeImage('));
});

test('calling from a profile card asks first and does not stay armed', () => {
  const plugin = read('plugins/HabitatLayout.plugin.js');
  const call = plugin.slice(plugin.indexOf("add('call'"), plugin.indexOf("const noteLabel"));
  assert.ok(call.indexOf('_showConfirmModal') > 0 && call.indexOf('_showConfirmModal') < call.indexOf("emit('start-dm'"));
  assert.match(call, /removeAttribute\('data-call-socket'\)/);
});

test('a destructive confirm starts on Cancel, resolves once, and returns focus to its opener', async () => {
  const doc = page();
  doc.body.innerHTML = '<button id="opener">Unpin</button>';
  const opener = doc.getElementById('opener');
  opener.focus();
  const app = load(doc, ['ui', 'utilities']);
  const result = app._showConfirmModal('Remove pin?', '', { danger: true });
  const cancel = doc.getElementById('confirm-modal-cancel');
  assert.equal(doc.activeElement, cancel);
  assert.ok(doc.getElementById('confirm-modal-ok').classList.contains('btn-danger-fill'));
  cancel.dispatch('click');
  assert.equal(await result, false);
  assert.equal(doc.activeElement, opener);
});

test('Escape closes a floating thread with a draft and leaves its reply text intact', () => {
  const doc = page();
  doc.body.innerHTML = '<button id="opener">Thread</button><div id="thread-panel" class="pip"><textarea id="thread-input"></textarea></div>';
  const app = load(doc, ['ui', 'threads']);
  const opener = doc.getElementById('opener');
  const input = doc.getElementById('thread-input');
  Object.assign(app, { _threadOpener: opener, _clearThreadReply() {} });
  input.value = 'unfinished reply';
  input.focus();
  app._bindEscapeShortcuts();
  doc.listeners.keydown[0]({ key: 'Escape', target: input, preventDefault() {}, stopImmediatePropagation() {} });
  assert.equal(doc.getElementById('thread-panel').style.display, 'none');
  assert.equal(input.value, 'unfinished reply');
  assert.equal(doc.activeElement, opener);
});

test('the alternate sign-in controls still open the linked-server form and admin recovery', () => {
  const doc = page();
  const html = read('public/index.html');
  doc.body.innerHTML = html.slice(html.indexOf('<div class="auth-tabs">'), html.indexOf('<!-- Theme selector'));
  const auth = read('public/js/auth.js');
  // Exercise the real local UI bindings without starting a login request or identity-provider handoff.
  const start = auth.indexOf("  const tabs = document.querySelectorAll('.auth-tab')");
  const end = auth.indexOf("  document.addEventListener('click', async (e) => {", auth.indexOf('// ── Admin Recovery', start));
  assert.ok(start >= 0 && end > start);
  vm.runInNewContext(auth.slice(start, end), { document: doc, _pendingInvite: '', eulaNotice: doc.getElementById('eula-notice') });
  const details = doc.querySelector('.auth-other');
  details.open = true;
  details.querySelector('[data-tab="sso"]').dispatch('click');
  assert.equal(doc.getElementById('sso-form').style.display, 'flex');
  assert.equal(doc.activeElement.id, 'sso-server-url');
  doc.querySelector('[data-tab="login"]').dispatch('click');
  details.open = true;
  details.querySelector('#admin-recover-show').dispatch('click');
  assert.equal(doc.getElementById('login-form').style.display, 'flex');
  assert.equal(doc.getElementById('admin-recover-section').style.display, '');
  assert.equal(doc.activeElement.id, 'login-username');
});

test('a touch release leaves the invite target available for click and only a mouse collapses on leave', () => {
  const doc = page();
  const app = load(doc, ['context']);
  const sent = [];
  Object.assign(app, { user: { id: 1, isAdmin: true }, channels: [{ name: 'General', id: 8 }],
    _hasPerm: () => true, _canManageBadges: () => false, _addGroupMemberActions() {}, _closeProfilePopup() {},
    _placeUserContextMenu(menu) { doc.body.appendChild(menu); }, _fitCtxMenu(menu, anchor) { assert.equal(anchor, undefined); },
    socket: { emit: (event, data) => sent.push([event, data.targetUserId, data.channelId]) } });
  app._showUserContextMenu({ target: { closest: () => null } }, 2);
  const wrap = doc.querySelector('.user-ctx-submenu-wrapper');
  const trigger = wrap.querySelector('button');
  const panel = wrap.querySelector('.user-ctx-submenu');
  wrap.dispatch('pointerenter', { pointerType: 'mouse' });
  assert.equal(trigger.getAttribute('aria-expanded'), 'true');
  wrap.dispatch('pointerleave', { pointerType: 'mouse' });
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  trigger.dispatch('click');
  for (const pointerType of ['touch', 'pen']) {
    wrap.dispatch('pointerleave', { pointerType });
    assert.equal(panel.style.display, 'block');
  }
  panel.querySelector('button').dispatch('click');
  assert.deepEqual(sent, [['invite-to-channel', 2, 8]]);
  assert.equal(doc.getElementById('user-context-menu'), null);
});

test('Channel Functions grows under the pointer, ignores pointer leave and reopens collapsed', () => {
  const doc = page();
  doc.body.innerHTML = '<button id="copy-code-btn"></button><div id="channel-ctx-menu">' +
    '<button data-action="channel-functions"><span class="cfn-arrow"></span></button><div id="channel-functions-panel"></div></div>';
  const app = load(doc, ['channel-context', 'channel-menu'], { window: { innerHeight: 900, innerWidth: 800 },
    requestAnimationFrame: fn => fn(), localStorage: { getItem: () => null } });
  Object.assign(app, { user: { isAdmin: true }, channels: [{ code: 'a' }], _bindChannelForms() {},
    _initDmSortMenu() {}, _initDmContextMenu() {}, _focusContextMenu() {}, _updateChannelFunctionsPanel() {} });
  app._bindChannelMenu();
  const menu = app._ctxMenuEl, panel = doc.getElementById('channel-functions-panel');
  const trigger = menu.querySelector('button'), arrow = trigger.querySelector('.cfn-arrow');
  const anchor = { getBoundingClientRect: () => ({ left: 20, top: 540, bottom: 556 }) };
  menu.offsetWidth = 250;
  let closedHeight = 250;
  Object.defineProperty(menu, 'offsetHeight', { get() {
    return Math.min(parseFloat(menu.style.maxHeight) || Infinity, panel.style.display === 'block' ? 510 : closedHeight);
  } });
  app._openChannelCtxMenu('a', anchor);
  assert.equal(menu.style.top, '560px');
  trigger.dispatch('click');
  trigger.dispatch('pointerleave', { pointerType: 'touch' });
  assert.equal(panel.style.display, 'block');
  assert.equal(trigger.getAttribute('aria-expanded'), 'true');
  assert.equal(arrow.textContent, '▼');
  assert.equal(menu.style.top, '560px');
  assert.equal(menu.style.maxHeight, '332px');
  app._closeChannelCtxMenu();
  closedHeight = 420;
  app._openChannelCtxMenu('a', anchor);
  assert.equal(menu.style.maxHeight, '');
  assert.equal(menu.style.top, '116px', 'opening a tall menu can still flip above');
  assert.equal(panel.style.display, 'none');
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  assert.equal(arrow.textContent, '▶');
});

test('a profile keeps its coordinates after presence replaces its anchor', () => {
  const doc = page();
  const app = load(doc, ['users'], { window: { innerWidth: 1100, innerHeight: 700 } });
  const card = doc.createElement('div');
  Object.assign(card, { offsetWidth: 280, offsetHeight: 340 });
  app._profilePopupAnchor = { isConnected: true,
    getBoundingClientRect: () => ({ left: 620, right: 710, top: 240, bottom: 268 }) };
  app._positionProfilePopup(card);
  assert.deepEqual([card.style.left, card.style.top], ['718px', '240px']);
  app._profilePopupAnchor = { isConnected: false, getBoundingClientRect: () => assert.fail('detached row measured') };
  card.offsetHeight = 380;
  app._positionProfilePopup(card);
  assert.deepEqual([card.style.left, card.style.top], ['718px', '240px']);
  const fresh = doc.createElement('div');
  app._positionProfilePopup(fresh);
  assert.equal(fresh.style.left, '50%');
  app._profilePopupAnchor = { isConnected: true, getBoundingClientRect: () => ({ left: 80, right: 100, top: 50, bottom: 70 }) };
  app._positionProfilePopup(fresh);
  assert.equal(fresh.style.left, '108px');
  assert.equal(fresh.style.transform, '');
});

test('the member row marks birthdays only on the day and keeps scores on the profile', () => {
  const doc = page();
  const app = load(doc, ['users', 'birthdays'], { localStorage: { getItem: () => null } });
  Object.assign(app, { user: { id: 1 }, _nicknames: {}, serverSettings: {}, _hasPerm: () => false,
    _canModerate: () => false, _sidebarActivityHtml: () => '', _pfpBorderMarker: () => '', _getUserColor: () => '',
    _getNickname: (id, name) => name, _nowZonedParts: () => ({ year: 2026, monthIndex: 10, day: 28 }),
    _profileScoreBadge: () => assert.fail('score lookup in a member row') });
  for (const [birthday, count] of [['11-28', 1], ['11-29', 0], [null, 0]]) {
    doc.body.innerHTML = app._renderUserItem({ id: 2, username: 'Kim', highScore: 42, birthday });
    assert.equal(doc.querySelectorAll('.birthday-mark').length, count);
    assert.equal(doc.querySelector('.user-item-name').textContent, 'Kim');
    assert.equal(doc.querySelector('.user-score-badge'), null);
  }
});

test('the note prompt enforces its requested limit on the editor itself', async () => {
  const doc = page();
  const app = load(doc, ['utilities']);
  const answer = app._showPromptModal('Note', 'This note is kept in this browser only.', '', { maxLength: 500 });
  assert.equal(doc.getElementById('prompt-modal-input').maxLength, 500);
  doc.getElementById('prompt-modal-cancel').dispatch('click');
  assert.equal(await answer, null);
});
