'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
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
    el.click = () => el.dispatch('click');
    el.closest = selector => {
      for (let node = el; node; node = node.parentElement) {
        if (selector.split(',').some(part => node._matches(part.trim()))) return node;
      }
      return null;
    };
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

// Run the document capture listener before the focused control. Buttons receive
// their native Enter click only if the keydown has not already been handled.
function pressKey(doc, key) {
  const target = doc.activeElement;
  const event = { key, target, preventDefault() { this.defaultPrevented = true; },
    stopImmediatePropagation() { this.stopped = true; } };
  for (const handler of doc.listeners.keydown || []) {
    handler(event);
    if (event.stopped) return;
  }
  const result = target.dispatch('keydown', { key });
  if (key === 'Enter' && !result.defaultPrevented && target.tagName === 'button') target.click();
}

test('the prompt selects its default after opening, accepts typed text and cancels on Escape', async () => {
  const doc = page();
  const app = load(doc, ['ui', 'utilities'], { setTimeout });
  doc.body.innerHTML = '<button id="rename">Rename</button>';
  const opener = doc.getElementById('rename');
  opener.focus();
  app._bindEscapeShortcuts();
  for (const key of ['Enter', 'Escape']) {
    const answer = app._showPromptModal('Name', '', 'Old name');
    const input = doc.getElementById('prompt-modal-input');
    let selected;
    input.select = () => { selected = input.value; };
    assert.equal(doc.activeElement, opener);
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(doc.activeElement, input);
    assert.equal(selected, 'Old name');
    input.value = 'New name';
    pressKey(doc, key);
    assert.equal(await answer, key === 'Enter' ? 'New name' : null);
    assert.equal(doc.activeElement, opener);
  }
});

test('only a destructive confirm defaults to Cancel and opening Enter cannot answer a dialog', async () => {
  const doc = page();
  const app = load(doc, ['ui', 'utilities'], { setTimeout });
  doc.body.innerHTML = '<input id="opener">';
  const opener = doc.getElementById('opener');
  const dialogs = [
    [() => app._confirm('Pin?'), 'Confirm', true],
    [() => app._confirm('Unpin?', { danger: true }), 'Cancel', false],
    [() => app._alert('Hello'), 'OK', 'ok'],
    [() => app._askChoice('Choose', '', [{ id: 'remove', danger: true, label: 'Remove' }, { id: 'cancel', label: 'Cancel' }]),
      'Cancel', 'cancel'],
  ];
  for (const [open, label, expected] of dialogs) {
    opener.focus();
    const answer = open();
    const modal = doc.querySelector('.modal');
    assert.equal(doc.activeElement, opener);
    if (expected === 'ok') {
      assert.equal(modal.querySelector('h3'), null);
      assert.ok(modal.getAttribute('aria-label'));
    } else {
      assert.ok(modal.querySelector('h3'));
    }
    if (expected === false) assert.ok(modal.querySelector('.btn-danger-fill'));
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(doc.activeElement.textContent, label);
    pressKey(doc, 'Enter');
    assert.equal(await answer, expected);
    assert.equal(doc.activeElement, opener);
  }
});

test('Escape preserves a thread draft and closes an empty floating thread only from inside', () => {
  const doc = page();
  doc.body.innerHTML = '<button id="opener">Thread</button><textarea id="message-input"></textarea>' +
    '<div id="thread-panel"><textarea id="thread-input"></textarea></div>';
  const app = load(doc, ['ui', 'threads']);
  const opener = doc.getElementById('opener');
  const input = doc.getElementById('thread-input');
  const panel = doc.getElementById('thread-panel');
  const composer = doc.getElementById('message-input');
  let clears = 0;
  Object.assign(app, { _threadOpener: opener, _clearThreadReply() { clears++; } });
  input.value = 'unfinished reply';
  app._bindEscapeShortcuts();
  for (const pip of [false, true]) {
    panel.classList.toggle('pip', pip);
    input.focus();
    pressKey(doc, 'Escape');
    assert.notEqual(panel.style.display, 'none');
    assert.equal(doc.activeElement, input);
    assert.equal(input.value, 'unfinished reply');
    assert.equal(clears, 0);
  }
  input.value = '';
  composer.focus();
  pressKey(doc, 'Escape');
  assert.notEqual(panel.style.display, 'none');
  assert.equal(doc.activeElement, composer);
  input.focus();
  pressKey(doc, 'Escape');
  assert.equal(panel.style.display, 'none');
  assert.equal(clears, 1);
  assert.equal(doc.activeElement, opener);
});

test('lightbox, thread and static modal restore a visible opener and leave unrelated focus alone', () => {
  const doc = page();
  doc.body.innerHTML = '<textarea id="message-input"></textarea><button id="in-thread">Picture</button>' +
    '<div id="image-lightbox"></div><div id="thread-panel"></div><div class="modal-overlay" id="media-gallery-modal"></div>';
  let notify;
  class MutationObserver {
    constructor(callback) { notify = callback; }
    observe() {}
  }
  const app = load(doc, ['ui', 'media', 'threads'], { MutationObserver });
  app._hideImageContextMenu = app._clearThreadReply = () => {};
  app._setupModalExpand();
  const opener = doc.getElementById('in-thread'), overlay = doc.getElementById('media-gallery-modal');
  for (const close of [
    () => { app._lightboxOpener = doc.activeElement; doc.body.focus(); app._closeLightbox(); },
    () => { app._threadOpener = doc.activeElement; doc.body.focus(); app._closeThread(); },
    () => {
      overlay.style.display = 'flex'; notify([{ target: overlay }]);
      overlay.style.display = 'none'; doc.body.focus(); notify([{ target: overlay }]);
    },
  ]) {
    opener.hidden = false;
    opener.focus();
    close();
    assert.equal(doc.activeElement, opener);
    opener.hidden = true;
    close();
    assert.equal(doc.activeElement, doc.body);
    close();
    assert.equal(doc.activeElement, doc.body);
  }
});

test('dismissal returns focus only for open pins, and a message edit gets Escape first', () => {
  const doc = page();
  doc.body.innerHTML = '<button id="pinned-toggle-btn"></button><button id="pinned-close"></button>' +
    '<div id="pinned-panel"></div><div id="pins-pip-panel"></div><button id="pins-pip-close"></button>' +
    '<button id="search-toggle-btn"></button><button id="search-close-btn"></button><input id="search-input">' +
    '<div class="message"><div class="message-content">Before</div></div>';
  const app = load(doc, ['ui', 'message-tools', 'message-content'], { AbortController });
  app._searchInit = app._hideMentionDropdown = app._hideEmojiDropdown = () => {};
  app._handleMarkdownShortcuts = app._composerListKey = () => false;
  app._bindSearchAndPins();
  app._bindEscapeShortcuts();
  const panel = doc.getElementById('pins-pip-panel'), dock = doc.getElementById('pinned-panel');
  const close = doc.getElementById('pins-pip-close'), toggle = doc.getElementById('pinned-toggle-btn');
  doc.body.focus();
  panel.style.display = 'none';
  close.click();
  assert.equal(doc.activeElement, doc.body);
  panel.style.display = 'flex';
  app._closePinsPiP(); // Channel switch and pop-in use this path.
  assert.equal(panel.style.display, 'none');
  assert.equal(doc.activeElement, doc.body);
  panel.style.display = 'flex';
  close.click();
  assert.equal(doc.activeElement, toggle);
  for (const pins of [panel, dock]) {
    panel.style.display = dock.style.display = 'none';
    pins.style.display = 'flex';
    const message = doc.querySelector('.message');
    app._startEditMessage(message, 7);
    assert.ok(message.classList.contains('editing'));
    pressKey(doc, 'Escape');
    assert.ok(!message.classList.contains('editing'));
    assert.equal(pins.style.display, 'flex');
    doc.body.focus();
    pressKey(doc, 'Escape');
    assert.equal(pins.style.display, 'none');
    assert.equal(doc.activeElement, toggle);
  }
  const menu = doc.createElement('details'), summary = doc.createElement('summary');
  doc.body.appendChild(menu);
  menu.append(summary, toggle);
  panel.style.display = 'flex';
  close.click();
  assert.equal(doc.activeElement, summary);
});

test('clicking an emoji category then pressing ArrowRight and Enter inserts the highlighted emoji once', () => {
  const doc = page();
  doc.body.innerHTML = '<div id="emoji-picker"></div><textarea id="message-input"></textarea>';
  const app = load(doc, ['emoji-picker'], { window: { innerWidth: 1000 } });
  app._skinTone = 'default';
  app.emojiCategories = { Smileys: ['😀'], Animals: ['🐶', '🐱'] };
  const picker = doc.getElementById('emoji-picker'), input = doc.getElementById('message-input');
  input.selectionStart = input.selectionEnd = 0;
  app._toggleEmojiPicker();
  const grid = picker.querySelector('.emoji-grid');
  const all = picker.querySelectorAll.bind(picker);
  picker.querySelectorAll = selector => selector === '.emoji-grid .emoji-item' ? grid.querySelectorAll('.emoji-item') : all(selector);
  const tab = picker.querySelectorAll('.emoji-tab').at(-1);
  tab.focus();
  tab.click();
  for (const key of ['ArrowRight', 'Enter']) {
    const event = picker.dispatch('keydown', { key, target: doc.activeElement });
    assert.ok(event.defaultPrevented);
  }
  assert.equal(input.value, '🐱');
  assert.equal(picker.style.display, 'none');
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
  trigger.dispatch('click', { pointerType: 'mouse', detail: 1 });
  assert.equal(trigger.getAttribute('aria-expanded'), 'true', 'clicking after mouse hover keeps it open');
  trigger.dispatch('click', { detail: 0 });
  assert.equal(trigger.getAttribute('aria-expanded'), 'false', 'keyboard click toggles');
  trigger.dispatch('click', { pointerType: 'touch', detail: 1 });
  assert.equal(trigger.getAttribute('aria-expanded'), 'true', 'touch click toggles');
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
  card.offsetHeight = 560;
  card.offsetWidth = 680;
  app._positionProfilePopup(card);
  assert.deepEqual([card.style.left, card.style.top], ['412px', '132px']);
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

test('a thread owns its reply across switches, closes, sends and parent deletion', () => {
  const doc = page();
  doc.body.innerHTML = '<div id="thread-panel"><span id="thread-panel-title"></span><span id="thread-parent-preview"></span>' +
    '<div id="thread-messages"></div><textarea id="thread-input"></textarea></div>';
  let expireThread;
  const app = load(doc, ['threads', 'socket-events', 'ui'], { localStorage: { getItem: () => null },
    setTimeout(fn, ms) { if (ms === 15000) expireThread = fn; },
  });
  const socket = new EventEmitter();
  Object.assign(app, { socket, _autoEmoteWords: text => text });
  app._listenMessageChanges();
  app._bindEscapeShortcuts();
  const input = doc.getElementById('thread-input');
  const notices = [];
  app._showToast = (...args) => notices.push(args);
  const composer = doc.createElement('textarea'), opener = doc.createElement('button');
  composer.id = 'message-input';
  doc.body.append(composer, opener);
  const open = id => app._openThread(id);
  const del = messageId => socket.emit('message-deleted', { messageId, channelCode: 'elsewhere' });
  open(1);
  input.value = '  unfinished reply\n';
  expireThread();
  const feed = doc.getElementById('thread-messages');
  assert.equal(feed.getAttribute('aria-busy'), 'false');
  assert.ok(feed.hasAttribute('data-failed'));
  open('1');
  assert.equal(feed.getAttribute('aria-busy'), 'true');
  assert.ok(!feed.hasAttribute('data-failed'));
  assert.equal(input.value, '  unfinished reply\n');
  open(2);
  assert.equal(input.value, '');
  pressKey(doc, 'Escape');
  assert.equal(app._activeThreadParent, null, 'another thread’s draft cannot hold this thread open');
  open(1);
  pressKey(doc, 'Escape');
  assert.equal(app._activeThreadParent, 1);
  assert.equal(input.value, '  unfinished reply\n');
  app._closeThread({ restoreFocus: false }); // switchChannel uses this path.
  open(2);
  input.value = 'second draft';
  open('1');
  assert.equal(input.value, '  unfinished reply\n');
  let sent;
  socket.once('send-thread-message', data => { sent = data; });
  app._sendThreadMessage();
  assert.equal(sent.content, 'unfinished reply');
  open(2);
  assert.equal(input.value, 'second draft');
  open(1);
  assert.equal(input.value, '', 'sending a restored draft consumes it');
  del('2');
  assert.equal(notices.length, 1, 'a cached unsent reply also gets a notice');
  open(2);
  assert.equal(input.value, '', 'deletion clears an inactive draft');
  input.value = 'about to be deleted';
  app._threadOpener = opener;
  composer.focus();
  del(2);
  assert.equal(doc.activeElement, composer);
  assert.equal(notices.length, 2);
  assert.deepEqual(notices[1], [notices[0][0], 'info']);
  assert.match(notices[1][0], /unsent.*parent message was deleted/i);
  assert.equal(app._activeThreadParent, null);
  open('2');
  assert.equal(input.value, '', 'closing a deleted parent does not recache it');

  app._threadOpener = opener;
  input.focus();
  del(2);
  assert.equal(doc.activeElement, opener);
  assert.equal(notices.length, 2, 'no discarded reply means no notice');
  const row = doc.createElement('li');
  row.setAttribute('data-msg-id', '3');
  doc.body.appendChild(row);
  row.appendChild(opener);
  opener.focus();
  open(3);
  del(3);
  assert.equal(doc.activeElement, composer, 'the deleted parent cannot serve as the opener');

  for (let id = 10; id < 43; id++) {
    open(id);
    input.value = String(id);
  }
  app._closeThread();
  open(10);
  assert.equal(input.value, '', 'oldest of 33 drafts was evicted');
  open(11);
  assert.equal(input.value, '11');
  open(42);
  assert.equal(input.value, '42');
});

function profileEditor(globals = {}) {
  const doc = page();
  doc.body.innerHTML = '<div id="rename-modal"><input id="rename-input"><textarea id="edit-profile-bio"></textarea>' +
    '<input id="edit-profile-birthday"><input id="edit-profile-birthday-hidden"><input id="edit-profile-birthday-hide-year">' +
    '<div id="user-profile-groups-manager"></div><button id="save-rename-btn"></button></div>';
  const field = id => doc.getElementById(id);
  for (const id of ['rename-input', 'edit-profile-bio', 'edit-profile-birthday']) {
    field(id).after = el => field(id).parentElement.appendChild(el);
  }
  for (const id of ['current-user', 'admin-controls', 'admin-mod-panel']) {
    const el = doc.createElement('div'); el.id = id; doc.body.appendChild(el);
  }
  const timers = new Map();
  const context = { document: doc, t, setTimeout(fn, ms) { timers.set(fn, ms); return fn; }, clearTimeout(fn) { timers.delete(fn); } };
  const HabitatForm = vm.runInNewContext(read('public/js/form-state.js') + '\nHabitatForm', context);
  const app = load(doc, ['people', 'socket-channels', 'socket-events', 'avatar-editor'], { HabitatForm, localStorage: { setItem() {} }, ...globals });
  const socket = new EventEmitter();
  socket.connected = true;
  const sent = [], notices = [];
  const theme = { top: '#abcdef', bottom: '#124578' };
  Object.assign(app, {
    socket, user: { username: 'Ada', bio: 'from second session', roles: [{ id: 5, level: 0 }], profileTheme: theme },
    _pendingBannerColor: null, _pendingProfileTheme: { bottom: theme.bottom, top: theme.top },
    _showToast: (...args) => notices.push(args), _renderUserBarAvatar() {}, _commitBorderDraft() {},
    _commitBannerPicture() { sent.push('avatar settings'); }, _renderUserProfileGroupsList() {},
    _hasGlobalPerm: () => false, _hasAnyAdminSettingsAccess: () => false, _safeHexColor: c => c,
    _cleanProfileTheme: v => v, _revertPendingChannelToggle() {}, _restoreRefusedDraft() {},
  });
  app._listenMessageChanges();
  app._listenPresenceAndVoice();
  for (const event of ['rename-user', 'set-bio', 'set-birthday', 'set-banner-color', 'set-profile-theme']) {
    socket.on(event, () => sent.push(event));
  }
  field('rename-input').value = 'Ada';
  field('edit-profile-bio').value = ' from second session ';
  Object.assign(field('edit-profile-birthday'), { value: '', validity: { valid: true } });
  field('edit-profile-birthday-hidden').checked = false;
  field('edit-profile-birthday-hide-year').checked = true;
  const groups = field('user-profile-groups-manager');
  groups.querySelectorAll = () => [{ dataset: { role: '5' } }];
  const modal = field('rename-modal'), button = field('save-rename-btn');
  modal.style.display = 'flex';
  return { app, field, socket, notices, sent, timers, groups, modal, button };
}

test('profile save skips known values and waits for each changed field and group receipt', async () => {
  const { app, field, socket, notices, sent, timers, groups, modal, button } = profileEditor();
  await app._saveRename();
  assert.deepEqual(sent.splice(0), ['avatar settings'], 'no socket writes for known values');
  assert.deepEqual(notices, []);

  modal.style.display = 'flex';
  field('rename-input').value = 'Ada Lovelace';
  field('edit-profile-birthday-hidden').checked = true;
  field('edit-profile-bio').value = 'changed bio';
  app._pendingBannerColor = '#123456';
  app._pendingProfileTheme = null;
  groups.querySelectorAll = () => [];
  let ack;
  socket.timeout = ms => ({ emitWithAck: event => {
    assert.equal(ms, 10000);
    sent.push(event);
    return new Promise(resolve => { ack = resolve; });
  } });
  const save = app._saveRename();
  assert.deepEqual(sent, ['rename-user', 'set-bio', 'set-birthday', 'set-banner-color', 'set-profile-theme', 'update-groups', 'avatar settings']);
  assert.deepEqual([...timers.values()], Array(5).fill(8000));
  for (const [, receipt, data] of [
    ['rename-user', 'renamed', { user: { displayName: 'Ada Lovelace' } }],
    ['set-bio', 'bio-updated', { bio: 'changed bio' }],
    ['set-birthday', 'birthday-updated', { birthdayHidden: true }],
    ['set-banner-color', 'banner-color-updated', { color: '#123456' }],
    ['set-profile-theme', 'profile-theme-updated', { theme: null }],
  ]) {
    assert.equal(button.disabled, true);
    socket.emit(receipt, data);
    await new Promise(setImmediate);
  }
  assert.equal(button.disabled, true);
  ack({ groups: [] });
  await save;
  assert.equal(sent.at(-1), 'avatar settings');
  assert.equal(modal.style.display, 'none');
  assert.equal(button.getAttribute('aria-busy'), null);
  assert.deepEqual(notices, []);
  assert.equal(timers.size, 0);
  assert.equal(socket.listenerCount('disconnect'), 0);
  assert.equal(socket.listenerCount('error-msg'), 1);
});

test('profile receipts can finish during avatar upload and the avatar event waits for its URL', async () => {
  let finishUpload;
  const { app, socket, field, button, modal } = profileEditor({
    FormData,
    fetch(url) {
      assert.equal(url, '/api/upload-avatar');
      return new Promise(resolve => { finishUpload = resolve; });
    },
  });
  const urls = [];
  socket.on('set-avatar', data => urls.push(data.url));
  app._pendingAvatarFile = new Blob(['picture']);
  app._pendingAvatarColor = async () => null;
  app._resetAvatarEditState = () => {};
  field('edit-profile-bio').value = 'Updated bio';
  const save = app._saveRename();
  await new Promise(setImmediate);
  assert.equal(typeof finishUpload, 'function');
  socket.emit('bio-updated', { bio: 'Updated bio' });
  assert.equal(button.disabled, true);
  assert.deepEqual(urls, []);
  finishUpload({ ok: true, json: async () => ({ url: '/uploads/avatar.jpg' }) });
  await save;
  assert.deepEqual(urls, ['/uploads/avatar.jpg']);
  assert.equal(modal.style.display, 'none');
});

test('silent birthday no-ops refresh both privacy flags and a first date once', async () => {
  for (const birthday of ['', '2000-11-28']) {
    const { app, field, timers, sent, notices, modal } = profileEditor();
    field('edit-profile-birthday').value = birthday;
    field('edit-profile-birthday-hidden').checked = true;
    field('edit-profile-birthday-hide-year').checked = false;
    const save = app._saveRename();
    for (const expire of [...timers.keys()]) expire();
    await save;
    assert.equal(app.user.birthday || '', birthday);
    assert.equal(app.user.birthdayHidden, true);
    assert.equal(app.user.birthdayHideYear, false);
    assert.equal(modal.style.display, 'none');
    modal.style.display = 'flex';
    await app._saveRename();
    assert.equal(sent.filter(event => event === 'set-birthday').length, 1);
    assert.deepEqual(notices, []);
  }
});

test('one deadline settles five silent fields while a refused birthday stays an error', async () => {
  const { app, field, socket, timers, notices, modal } = profileEditor();
  field('rename-input').value = 'Changed';
  field('edit-profile-bio').value = 'Updated';
  field('edit-profile-birthday').value = '2000-11-28';
  app._pendingBannerColor = '#123456';
  app._pendingProfileTheme = null;
  const save = app._saveRename();
  assert.equal(timers.size, 5);
  socket.emit('error-msg', 'Your birthday can only be set once.');
  for (const expire of [...timers.keys()]) expire();
  await save;
  assert.equal(modal.style.display, 'flex');
  assert.equal(field('edit-profile-birthday-error').textContent, 'Your birthday can only be set once.');
  assert.equal(app.user.birthday, undefined);
  assert.deepEqual(notices, [[t('surface.profile_unconfirmed'), 'error']]);
});

test('a late bio receipt allows saving the opening text again', async () => {
  const { app, field, socket, timers, sent } = profileEditor();
  const bio = field('edit-profile-bio');
  const opening = app.user.bio;
  app._bioOpened = opening; // Opening snapshot used by clients before this fix.
  bio.value = 'Later';
  let save = app._saveRename();
  for (const expire of [...timers.keys()]) expire();
  await save;
  socket.emit('bio-updated', { bio: 'Later' });
  bio.value = opening;
  save = app._saveRename();
  assert.equal(sent.filter(event => event === 'set-bio').length, 2);
  socket.emit('bio-updated', { bio: opening });
  await save;
  assert.equal(app.user.bio, opening);
});

test('server refusals preserve the name and bio and unrelated errors keep their ordinary notices', async () => {
  const { app, field, socket, notices, modal, groups } = profileEditor();
  const name = field('rename-input'), bio = field('edit-profile-bio');
  name.value = 'New Name';
  bio.value = 'a refused bio';
  groups.querySelectorAll = () => [];
  socket.timeout = () => ({ emitWithAck: async () => ({ error: 'Group refused.' }) });
  const save = app._saveRename();
  socket.emit('error-msg', 'Slow mode: wait 5s before sending another message');
  socket.emit('automod-refused', { surface: 'message' });
  socket.emit('error-msg', 'Chat verdict');
  assert.equal(app._profileRenameExpected, name.value);
  socket.emit('error-msg', 'That display name is already taken on this server');
  socket.emit('error-msg', 'A second unrelated error');
  await new Promise(setImmediate);
  assert.equal(app._profileRenameExpected, null);
  socket.emit('automod-refused', { surface: 'profile' });
  socket.emit('error-msg', 'Profile verdict');
  await save;
  assert.equal(name.value, 'New Name');
  assert.equal(bio.value, 'a refused bio');
  assert.equal(modal.style.display, 'flex');
  assert.equal(name.getAttribute('aria-invalid'), 'true');
  assert.equal(bio.getAttribute('aria-invalid'), 'true');
  assert.equal(field('rename-input-error').textContent, 'That display name is already taken on this server');
  assert.equal(field('edit-profile-bio-error').textContent, 'Profile verdict');
  assert.deepEqual(notices, ['Slow mode: wait 5s before sending another message', 'Chat verdict',
    'A second unrelated error', 'Group refused.'].map(message => [message, 'error']));
});

test('a shared profile verdict follows the missing receipt when both text fields are pending', async () => {
  const { app, socket, field } = profileEditor();
  field('rename-input').value = 'Accepted Name';
  field('edit-profile-bio').value = 'refused bio';
  const saving = app._saveRename();
  socket.emit('automod-refused', { surface: 'profile' });
  socket.emit('error-msg', 'Profile verdict');
  socket.emit('renamed', { user: { displayName: 'Accepted Name' } });
  await saving;
  assert.equal(field('edit-profile-bio-error').textContent, 'Profile verdict');
  assert.equal(field('rename-input-error'), null);
});

test('untagged preview automod is a bio refusal and a shared flood warning is a general error', async () => {
  const { app, field, socket, notices, modal } = profileEditor();
  field('edit-profile-bio').value = 'changed bio';
  const verdict = "Links to example.test aren't allowed here (blocked).";
  let save = app._saveRename();
  socket.emit('error-msg', verdict);
  await save;
  assert.equal(field('edit-profile-bio-error').textContent, verdict);
  assert.equal(modal.style.display, 'flex');
  assert.deepEqual(notices, []);
  save = app._saveRename();
  socket.emit('error-msg', 'Slow down: too many requests');
  await save;
  assert.deepEqual(notices, [['Slow down: too many requests', 'error']]);
});

test('an unanswered rename releases its marker and a later rename is announced', async () => {
  const { app, field, socket, timers, notices, modal, button } = profileEditor();
  field('rename-input').value = 'Later';
  const save = app._saveRename();
  socket.emit('renamed', { user: { displayName: 'Other' } });
  assert.equal(app._profileRenameExpected, 'Later');
  assert.equal(timers.size, 1, 'another rename cannot confirm this one');
  for (const expire of [...timers.keys()]) expire();
  await save;
  assert.equal(modal.style.display, 'flex');
  assert.equal(button.getAttribute('aria-busy'), null);
  assert.equal(app._profileRenameExpected, null);
  assert.match(notices.at(-1)[0], /did not confirm/);
  socket.emit('renamed', { user: { displayName: 'Later' } });
  assert.equal(notices.at(-1)[1], 'success');
  assert.equal(app.user.displayName, 'Later');
});

test('a disconnected rename clears its marker and a missing group acknowledgement keeps the editor open', async () => {
  const { app, field, socket, notices, modal, groups } = profileEditor();
  field('rename-input').value = 'Later';
  const save = app._saveRename();
  socket.connected = false;
  socket.emit('disconnect');
  await save;
  assert.equal(app._profileRenameExpected, null);
  assert.deepEqual(notices.pop(), [t('auth.errors.connection_error'), 'error']);
  socket.connected = true;
  field('rename-input').value = 'Ada';
  groups.querySelectorAll = () => [];
  socket.timeout = () => ({ emitWithAck: async () => { throw new Error('timeout'); } });
  await app._saveRename();
  assert.equal(modal.style.display, 'flex');
  assert.deepEqual(notices, [[t('toasts.role_server_no_response'), 'error']]);
});

test('invite creation stays busy across unrelated errors and releases on timeout, refusal, receipt or disconnect', async () => {
  const doc = page(), fields = new Map();
  doc.getElementById = id => {
    if (!fields.has(id)) fields.set(id, Object.assign(doc.createElement('input'), { id, value: '', validity: { valid: true } }));
    return fields.get(id);
  };
  let expire;
  const timers = { setTimeout(fn, ms) { assert.equal(ms, 8000); expire = fn; }, clearTimeout() { expire = null; } };
  const HabitatForm = vm.runInNewContext(read('public/js/form-state.js') + '\nHabitatForm', { document: doc, ...timers });
  const app = load(doc, ['admin-controls'], { HabitatForm });
  const socket = app.socket = new EventEmitter();
  socket.connected = true;
  app._setupTransferAdminRow = () => {};
  const notices = [];
  app._showToast = (...args) => notices.push(args);
  app._bindAdminControls();
  const label = doc.getElementById('invite-new-label'), button = doc.getElementById('invite-create-btn');
  label.value = 'Team';
  const create = () => button.listeners.click[0]({ currentTarget: button });
  let sends = 0;
  socket.on('create-invite-code', () => sends++);
  let saving = create();
  socket.emit('error-msg', 'Slow mode: wait 5s before sending another message');
  await create();
  assert.equal(sends, 1);
  assert.equal(button.disabled, true);
  expire();
  await saving;
  assert.equal(button.getAttribute('aria-busy'), null);
  assert.equal(label.value, 'Team');
  assert.equal(notices.length, 1);
  assert.match(notices[0][0], /invite may not have been created/i);
  assert.equal(notices.pop()[1], 'info');
  saving = create();
  socket.emit('error-msg', "You don't have permission to manage invite links");
  await saving;
  assert.equal(expire, null);
  assert.equal(label.value, 'Team');
  doc.getElementById('invite-new-slug').value = 'abc';
  saving = create();
  socket.emit('toast', { type: 'success', message: 'Something else' });
  socket.emit('toast', { type: 'success', message: 'Invite link created: other' });
  await Promise.resolve();
  assert.equal(button.disabled, true);
  socket.emit('toast', { type: 'success', message: 'Invite link created: abc' });
  await saving;
  assert.equal(label.value, '');
  assert.deepEqual(notices, []);
  label.value = 'Offline';
  saving = create();
  socket.connected = false;
  socket.emit('disconnect');
  await saving;
  assert.deepEqual(notices, [[t('auth.errors.connection_error'), 'error']]);
  assert.equal(button.getAttribute('aria-busy'), null);
  assert.equal(label.value, 'Offline');
});

test('replacing the server mute menu repeatedly leaves one outside-click listener and Escape releases it', () => {
  const doc = page();
  const make = doc.createElement;
  doc.createElement = tag => {
    const el = make(tag);
    el.getBoundingClientRect = () => ({ right: 80, bottom: 100 });
    return el;
  };
  const app = load(doc, ['server-mute', 'ui'], { window: {}, location: { origin: 'https://example.test' } });
  app._serverMuteMode = () => 'off';
  app._bindEscapeShortcuts();
  for (let i = 0; i < 4; i++) {
    app._showServerMuteMenu({ clientX: 10, clientY: 10 }, { own: true });
    assert.equal(doc.listeners.click.length, 1);
  }
  pressKey(doc, 'Escape');
  assert.equal(doc.getElementById('server-mute-menu'), null);
  assert.equal(doc.listeners.click.length, 0);
});
