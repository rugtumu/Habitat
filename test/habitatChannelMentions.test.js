'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { makeDocument } = require('./fakeDom');

function setup() {
  const document = makeDocument();
  const list = document.createElement('div');
  list.id = 'channel-list';
  document.body.appendChild(list);
  document.querySelector = selector => list.children.find(row => selector === `.channel-item[data-code="${row.dataset.code}"]`);
  const data = new Map([['haven_mentions_seen_upto', '20']]);
  const localStorage = {
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
    removeItem: key => data.delete(key),
  };
  const app = {};
  for (const file of ['app-mentions.js', 'app-channel-unread.js', 'app-socket.js', 'app-channels.js']) {
    const src = fs.readFileSync(path.join(__dirname, '../public/js/modules', file), 'utf8');
    Object.assign(app, vm.runInNewContext(src.replace('export default {', '({').replace(/};\s*$/, '})'),
      { document, localStorage, t: k => k, setTimeout() {}, clearTimeout() {} }));
  }
  Object.assign(app, {
    user: { id: 1, username: 'alex' }, currentChannel: 'room', channels: [
      { code: 'room', name: 'General', id: 1 }, { code: 'dm', is_dm: 1, id: 2 },
    ], unreadCounts: { room: 12, dm: 3 }, _threadMentions: { room: [1] },
    _getHiddenChannels: () => [], _applyPersonalChannelOrder: a => a, _applyPersonalCategoryOrder: a => a,
    _escapeHtml: s => s, _hasPerm: () => false, _updateChannelVoiceIndicators() {}, _setupChannelDragDrop() {},
    _setupDmDragDrop() {}, _setupPersonalChannelOrder() {}, _decorateArrangeMode() {}, _updateNestedIndicators() {},
    _updateTabTitle() {}, _updateDesktopBadge() {}, _searchRun() {},
  });
  app._mentionsMerge([{ code: 'room', unreadMentionIds: [10, 21] }, { code: 'dm', is_dm: 1, unreadMentionIds: [22] }]);
  app._renderChannels();
  const row = list.querySelector('.channel-item');
  // The fixture DOM supports simple selectors. Honor each exclusion in the actual badge lookup.
  row.querySelector = selector => row.children.find(node => node.classList.contains('channel-badge') &&
    ![...selector.matchAll(/:not\(\.([\w-]+)\)/g)].some(([, name]) => node.classList.contains(name)));
  return { app, row };
}

test('server IDs seed the first row, union with live personal mentions, and survive opening @', async () => {
  const { app, row } = setup();
  const [badge] = row.children;
  assert.equal(badge.textContent, '12');
  assert.equal(badge.dataset.mentions, '2', 'the row includes IDs before the account watermark');
  assert.deepEqual(Array.from(app._unseenMentions, m => m.id), [21]);
  assert.equal(app._mentionCountFor('dm'), 0);
  await app._mentionsOpen();
  assert.equal(app._unseenMentions.length, 0);
  assert.equal(app._mentionCountFor('room'), 2);
  app._mentionsCount({ id: 25, content: '@everyone @here @moderators' }, 'room');
  assert.equal(badge.dataset.mentions, '2');
  app._mentionsCount({ id: 26, content: 'hi @alex!' }, 'room');
  app._mentionsCount({ id: 27, replyContext: { user_id: 1 } }, 'room');
  app._mentionsCount({ id: 27, replyContext: { user_id: 1 } }, 'room');
  assert.equal(badge.dataset.mentions, '4');
  app._mentionsMerge([{ code: 'room', unreadMentionIds: [21, 28] }]);
  assert.equal(app._mentionCountFor('room'), 5);
  app._mentionsSeenInChannel('room', 26);
  assert.equal(badge.dataset.mentions, '2', 'an earlier read receipt leaves later mentions visible');
  app._mentionsSeenInChannel('room');
  assert.equal(badge.dataset.mentions, undefined);
  assert.equal(badge.textContent, '12');
});

test('zero clears stored IDs even without a row, and a thread bell is never the unread badge', () => {
  const { app, row } = setup();
  const bell = row.children[1];
  app.unreadCounts.room = 0;
  app._updateBadge('room');
  assert.deepEqual(row.children, [bell]);
  app.unreadCounts.room = 1;
  app._updateBadge('room');
  assert.equal(row.children[1].textContent, '1');
  assert.equal(row.children[1].dataset.mentions, undefined);
  assert.equal(bell.textContent, '🔔1');
  row.remove();
  app._mentionsCount({ id: 35, content: '@alex' }, 'room');
  assert.equal(app._mentionCountFor('room'), 1);
  app.unreadCounts.room = 0;
  assert.equal(app._mentionCountFor('room'), 0);
  app._updateBadge('room');
  app.unreadCounts.room = 1;
  assert.equal(app._mentionCountFor('room'), 0);
});

test('rotations retain local and newly seeded IDs and cap the visible count at 99+', () => {
  const { app, row } = setup();
  app._migrateChannelCodeState('room', 'new');
  app.channels[0].code = row.dataset.code = 'new';
  app._mentionsMerge([{ code: 'new', unreadMentionIds: [10, 31] }]);
  assert.equal(app._mentionCountFor('new'), 3);
  assert.equal(app._mentionCountFor('room'), 0);
  app.unreadCounts.new = 120;
  app._mentionsMerge([{ code: 'new', unreadMentionIds: Array.from({ length: 99 }, (_, i) => i + 1) }]);
  app._updateBadge('new');
  assert.equal(row.children[0].dataset.mentions, '99+');
  assert.equal(row.children[0].textContent, '99+');
});

test('the spoken channel badge follows the transition from mentions to ordinary unreads', () => {
  const { app, row } = setup();
  const badge = row.children[0];
  assert.equal(badge.getAttribute('role'), 'img');
  assert.equal(badge.getAttribute('aria-label'), 'messages.new_messages · 12, app.actions.mentions · 2');
  app._mentionsSeenInChannel('room');
  app.unreadCounts.room = 4;
  app._updateBadge('room');
  assert.equal(badge.getAttribute('aria-label'), 'messages.new_messages · 4');
});
