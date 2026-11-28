'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const main = read('public/js/modules/app-channels.js');
const socket = read('public/js/modules/app-socket-channels.js');
const pip = read('public/js/modules/app-pip-panels.js').replace(/^import .*;$/m, '');
const html = read('public/app.html');
const layout = read('plugins/HabitatLayout.plugin.js');
const css = read('public/css/style-messages.css');
const room = { id: 3, code: 'aaaaaaaa', name: 'General', latestMessageId: 21 };
const dm = { id: 5, code: 'bbbbbbbb', is_dm: 1, name: 'DM', latestMessageId: 32 };
const voice = { id: 8, code: 'cccccccc', name: 'Call', text_enabled: 0, media_enabled: 0, voice_enabled: 1 };

function storage() {
  const values = new Map();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  };
}

// Drive the real switch, channel-list and history listeners. Only the other
// UI modules and the transport are replaced.
function client({ localStorage = storage(), search = '', user = { id: 7 }, touch = true, layoutMark = 'data-habitat-layout', visibilityState = 'visible', addDialog = null } = {}) {
  const noop = () => {};
  const events = new Map(), elements = new Map(), timers = new Map();
  const sent = [], rendered = [];
  const el = id => {
    if (!elements.has(id)) elements.set(id, {
      hidden: true, dataset: {}, attributes: {}, style: { setProperty: noop, removeProperty: noop },
      classList: { remove: noop, add: noop, toggle: noop },
      setAttribute(k, v) { this.attributes[k] = v; },
      addEventListener(k, fn) { this[k] = fn; },
    });
    return elements.get(id);
  };
  const sessionStorage = storage();
  const location = { search, pathname: '/app' };
  const context = vm.createContext({
    document: { visibilityState, documentElement: { hasAttribute: key => key === layoutMark },
      addEventListener: (event, fn) => events.set(event, fn),
      removeEventListener: event => events.delete(event),
      getElementById: el, querySelector: selector => selector === '[data-habitat-dialog]' ? addDialog : null, querySelectorAll: () => [] },
    window: { location, history: { replaceState: () => { location.search = ''; } }, matchMedia: () => ({ matches: touch }) },
    navigator: {}, localStorage, sessionStorage, URLSearchParams, t: key => key, console,
    setTimeout(fn, ms) { const id = Symbol(); timers.set(id, { fn, ms }); return id; },
    clearTimeout: id => timers.delete(id),
  });
  const methods = source => vm.runInContext(source.replace('export default {', '({').replace(/};\s*$/, '})'), context);
  let pickerOpens = 0;
  const app = {
    ...methods(main), ...methods(socket), ...methods(pip),
    _refreshDMPipHeader: noop, _openDMPiPBody: noop,
    user, currentChannel: null, channels: [], unreadCounts: {}, serverSettings: {},
    socket: { on: (event, fn) => events.set(event, fn), emit: (event, data) => sent.push([event, data]) },
    _collectChannelCodeRotations: () => [], _persistChannelCodeMap: noop,
    _renderChannels() { this._updateWelcomeChoices(); },
    _updateTabTitle: noop, _updateDesktopBadge: noop, _updateDmSectionBadge: noop,
    _clearImageQueue: noop, _draftStash: noop, _draftRestore: noop, _markDmView: noop,
    _hasPerm: () => false, _setSelfDestructArmed: noop, _voiceJoinAvailable: () => false,
    _canModerate: () => false, _updateTopicBar: noop, _updateDmCleanupNotice: noop,
    _updateComposerVisibility: noop, _updateBadge: noop, _clearReply: noop, _closeThread: noop,
    _updateE2EIndicator: noop, _fetchDMPartnerKey: noop, _showToast: noop, _decryptMessages: noop,
    _prependMessages: noop, _renderMessages: rows => rendered.push(rows),
    _openQuickSwitcher: () => { pickerOpens++; },
  };
  app._listenChannelsAndMessages();
  return { app, localStorage, sessionStorage, sent, el, rendered, pickerOpens: () => pickerOpens,
    visibility(state) {
      context.document.visibilityState = state;
      events.get('visibilitychange')?.();
    },
    list: rows => events.get('channels-list')(rows),
    history: (messages, extra = {}) => events.get('message-history')({ channelCode: app.currentChannel, messages, ...extra }),
    disconnect: () => events.get('disconnect')(),
    tick(ms) {
      for (const [id, timer] of [...timers]) {
        if (timer.ms <= ms && timers.delete(id)) timer.fn();
      }
    },
  };
}

test('reopening selects only the saved member conversation, including a DM or voice room with a rotated code', async () => {
  for (const previous of [room, dm, voice]) {
    const first = client();
    first.list([room, dm, voice]);
    assert.equal(first.app.currentChannel, null);
    await first.app.switchChannel(previous.code);
    const next = client({ localStorage: first.localStorage });
    const rotated = { ...previous, code: 'dddddddd' };
    next.list([room, dm, voice].map(ch => ch.id === previous.id ? rotated : ch));
    await Promise.resolve();
    assert.equal(next.app.currentChannel, rotated.code);
    assert.deepEqual(next.sent.filter(([ev]) => ev === 'enter-channel').map(([, data]) => data.code), [rotated.code]);
    assert.ok(next.sent.every(([ev, data]) => ev !== 'voice-join' && (ev !== 'mark-read' || data.code === rotated.code)));
    const other = client({ localStorage: first.localStorage, user: { id: 9 } });
    other.list([rotated]);
    assert.equal(other.app.currentChannel, null);
  }
});

test('switching channels preserves the dialog opener’s focus after a server reply', async () => {
  const addDialog = { hidden: false };
  const c = client({ touch: false, addDialog });
  c.list([room, voice]);
  let composerFocus = 0;
  c.el('message-input').focus = () => { composerFocus++; };
  await c.app.switchChannel(room.code);
  addDialog.hidden = true;
  c.tick(50);
  assert.equal(composerFocus, 0);
  await c.app.switchChannel(voice.code);
  c.tick(50);
  assert.equal(composerFocus, 1);
});

test('switching channels on touch leaves the keyboard closed even if the composer opened a thread', async () => {
  const c = client({ touch: true });
  c.list([room]);
  const composer = c.el('message-input');
  let closed = false;
  composer.focus = () => assert.fail('channel switch focused the composer');
  c.app._closeThread = ({ restoreFocus = true } = {}) => {
    closed = true;
    if (restoreFocus) composer.focus();
  };
  await c.app.switchChannel(room.code);
  c.tick(50);
  assert.ok(closed);
});

test('a saved DM follows the member’s current opening preference', async () => {
  const c = client();
  c.list([room, dm]);
  await c.app.switchChannel(room.code);
  c.app._openDMPiP(dm.code);
  for (const main of [false, true]) {
    c.localStorage.setItem('haven_dm_fullscreen_default', String(main));
    const returning = client({ localStorage: c.localStorage });
    returning.list([room, dm]);
    assert.equal(returning.app.currentChannel, main ? dm.code : null);
    assert.equal(returning.app._activeDMPip, main ? undefined : dm.code);
  }
  c.app._closeDMPiP();
  const returning = client({ localStorage: c.localStorage });
  returning.list([room, dm]);
  assert.equal(returning.app.currentChannel, room.code);
});

test('the first channel list restores a DM during boot and honors an explicit window preference', () => {
  for (const choice of [null, 'false', 'true']) {
    const c = client({ layoutMark: 'data-habitat-boot' });
    c.app._rememberConversation(dm);
    if (choice !== null) c.localStorage.setItem('haven_dm_fullscreen_default', choice);
    c.list([room, dm]);
    assert.equal(c.app.currentChannel, choice === 'false' ? null : dm.code);
    assert.equal(c.app._activeDMPip, choice === 'false' ? dm.code : undefined);
  }
});

test('a hidden tab waits for visibility and respects a conversation opened in the meantime', () => {
  for (const opened of [null, 'channel', 'pip', 'closed', 'invite']) {
    const c = client({ visibilityState: 'hidden' });
    c.app._rememberConversation(room);
    c.list([room, dm]);
    c.visibility('hidden');
    const reads = () => c.sent.filter(([event, data]) => event === 'mark-read' && data.code === room.code);
    assert.equal(reads().length, 0);
    assert.equal(c.app.currentChannel, null);
    if (opened === 'channel') c.app.switchChannel(dm.code);
    if (opened === 'pip' || opened === 'closed') c.app._openDMPiP(dm.code);
    if (opened === 'closed') c.app._closeDMPiP();
    if (opened === 'invite') c.sessionStorage.setItem('haven_pending_invite', 'invite');
    c.visibility('visible');
    c.visibility('visible');
    assert.equal(reads().length, opened ? 0 : 1);
    assert.equal(c.app.currentChannel, opened === 'channel' ? dm.code : opened ? null : room.code);
  }
});

test('missing conversations, invites and explicit links cannot mark the remembered channel read', () => {
  for (const [search, expected] of [['?invite=invite', null], ['?channel=dddddddd', null], ['?channel=bbbbbbbb&message=4', dm.code], ['', null]]) {
    const c = client({ search });
    c.app._rememberConversation(room);
    c.list(search ? [room, dm] : [dm]);
    c.list([room, dm]);
    assert.equal(c.app.currentChannel, expected);
    assert.ok(c.sent.every(([event, data]) => event !== 'enter-channel' || data.code === expected));
    if (search.includes('invite')) assert.equal(c.sent.filter(([ev]) => ev === 'join-channel').length, 1);
  }
  for (const key of ['haven_pending_invite', 'haven_pending_channel']) {
    const c = client();
    c.app._rememberConversation(dm);
    c.sessionStorage.setItem(key, room.code);
    c.list([room, dm]);
    assert.equal(c.app.currentChannel, null);
  }
});

test('Welcome waits for the list, keeps onboarding for zero channels, and opens the picker for a member with conversations', () => {
  const c = client();
  assert.match(html, /id="welcome-new-member" hidden data-i18n="welcome.subtitle"/);
  assert.match(html, /id="welcome-conversations" hidden/);
  for (const rows of [[], [dm], []]) {
    c.list(rows);
    assert.equal(c.el('welcome-new-member').hidden, rows.length > 0);
    assert.equal(c.el('welcome-conversations').hidden, rows.length === 0);
    if (rows.length) c.el('welcome-find').click();
  }
  assert.equal(c.pickerOpens(), 1);
  assert.equal(c.app.currentChannel, null);
});

test('slow, empty, full, older and around pages have distinct presentation', async () => {
  const c = client();
  c.list([room]);
  await c.app.switchChannel(room.code);
  const list = c.el('messages');
  assert.equal(list.dataset.history, 'pending');
  assert.equal(list.attributes['aria-busy'], 'true');
  c.tick(149);
  assert.equal(list.dataset.history, 'pending');
  c.tick(150);
  assert.equal(list.dataset.history, 'loading');
  await c.history([], { channelCode: dm.code });
  assert.equal(list.dataset.history, 'loading');
  await c.history([]);
  assert.equal(list.dataset.history, 'empty');
  assert.equal(list.attributes['aria-busy'], 'false');
  await c.history([{ id: 1 }]);
  assert.equal(list.dataset.history, 'start');
  await c.history(Array.from({ length: 80 }, (_, i) => ({ id: i + 1 })));
  assert.equal(list.dataset.history, 'ready');
  assert.equal(c.app._noMoreHistory, false);
  c.app._historyBefore = 1;
  await c.history([]);
  assert.equal(list.dataset.history, 'start');
  await c.history([], { around: 13 });
  assert.equal(list.dataset.history, 'ready');
  assert.match(layout, /\[data-haven-region="message-list"\]\[data-history="empty"\][^\n]+\+ \[data-habitat-intro\]/);
  assert.match(css, /\.history-status\s*\{\s*position: absolute/);
});

test('a timeout or disconnect shows retry and a fast retry cancels the delayed loading label', async () => {
  for (const fail of [c => c.tick(5000), c => c.disconnect(), c => c.history(null)]) {
    const c = client();
    c.list([room]);
    await c.app.switchChannel(room.code);
    await fail(c);
    assert.equal(c.el('messages').dataset.history, 'failed');
    c.el('history-retry').click();
    assert.equal(c.el('messages').dataset.history, 'pending');
    assert.deepEqual(c.sent.filter(([ev]) => ev === 'get-messages').map(([, d]) => d.code), [room.code, room.code]);
    assert.equal(c.sent.filter(([ev]) => ev === 'mark-read').length, 1);
    await c.history([]);
    c.tick(5000);
    assert.equal(c.el('messages').dataset.history, 'empty');
  }
});

test('a DM reply finishing decryption after a switch cannot settle the new page', async () => {
  const c = client();
  c.list([room, dm]);
  await c.app.switchChannel(dm.code);
  let finish;
  c.app._decryptMessages = () => new Promise(resolve => { finish = resolve; });
  const pending = c.history([{ id: 3 }]);
  await c.app.switchChannel(room.code);
  finish();
  await pending;
  assert.equal(c.el('messages').dataset.history, 'pending');
  assert.deepEqual(c.rendered, []);
});

test('a DM left during key lookup keeps its read receipt and cannot replace the current history request', async () => {
  const c = client();
  c.list([room, dm]);
  let finish;
  c.app._fetchDMPartnerKey = () => new Promise(resolve => { finish = resolve; });
  const switching = c.app.switchChannel(dm.code);
  await c.app.switchChannel(room.code);
  finish();
  await switching;
  assert.deepEqual(c.sent.filter(([ev]) => ev === 'mark-read').map(([, d]) => d.code), [room.code, dm.code]);
  assert.deepEqual(c.sent.filter(([ev]) => ev === 'get-messages').map(([, d]) => d.code), [room.code]);
  assert.equal(c.app._pendingChannelHistoryCode, room.code);
});
