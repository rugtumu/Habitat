'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { makeDocument, parseHtml } = require('./fakeDom');

const defaults = ['react', 'reply', 'edit', 'quote', 'thread', 'copy-link', 'pin', 'archive', 'nsfw', 'delete'];
const legacy = ['react', 'reply', 'quote', 'thread', 'copy-link', 'pin', 'archive', 'nsfw', 'edit', 'delete'];
const orderKey = 'haven-toolbar-order';
const slotsKey = 'haven-toolbar-visible-slots';

const read = file => fs.readFileSync(path.join(__dirname, '../public/js/modules', file), 'utf8');

test('the picker and renderer take their order from one preference reader', () => {
  const appearance = read('app-appearance.js');
  const messages = read('app-messages.js');
  for (const source of [appearance, messages]) assert.match(source, /this\._toolbarPreferences\(\)/);
  const orderLiteral = JSON.stringify(defaults);
  const arrays = (appearance + messages).match(/\[(?:'[\w-]+'(?:,\s*)?)+\]/g);
  assert.equal(arrays.filter(a => JSON.stringify(JSON.parse(a.replaceAll("'", '"'))) === orderLiteral).length, 1);
});

function setup(order, slots) {
  const stored = new Map();
  const writes = [];
  if (order) stored.set(orderKey, JSON.stringify(order));
  if (slots) stored.set(slotsKey, slots);
  const document = makeDocument();
  document.documentElement = document.createElement('html');
  for (const id of ['toolbar-icon-picker', 'toolbar-visible-slots', 'toolbar-order-list', 'toolbar-order-reset-btn']) {
    const node = document.createElement('div');
    node.id = id;
    document.body.appendChild(node);
  }
  const localStorage = {
    getItem: key => stored.get(key) ?? null,
    setItem(key, value) { writes.push(key); stored.set(key, value); },
  };
  const app = {};
  for (const file of ['app-appearance.js', 'app-messages.js']) {
    const source = read(file);
    Object.assign(app, vm.runInNewContext(source.replace('export default {', '({').replace(/};\s*$/, '})'),
      { localStorage, document, t: key => key }));
  }
  app._setupToolbarIconPicker();
  return { app, stored, writes, document };
}

test('opening the picker resolves saved preferences without writing either key', () => {
  const custom = [...defaults].reverse();
  for (const [order, slots, expected] of [
    [undefined, undefined, defaults], [legacy, undefined, defaults], [legacy, '3', defaults],
    [legacy, '4', legacy], [custom, '3', custom],
  ]) {
    const { app, document, writes } = setup(order, slots);
    assert.deepEqual([...app._toolbarPreferences().order], expected);
    const rows = document.getElementById('toolbar-order-list').children;
    assert.deepEqual(rows.map(row => row.innerHTML.match(/data-key="([^"]+)"/)[1]), expected);
    assert.deepEqual(writes, []);
  }
});

test('changing slots preserves the displayed migrated order, and reorder and reset persist', () => {
  const { app, document, stored } = setup(legacy, '3');
  const slider = document.getElementById('toolbar-visible-slots');
  slider.value = '5';
  slider.dispatch('change');
  assert.equal(stored.get(slotsKey), '5');
  assert.deepEqual([...app._toolbarPreferences().order], defaults);
  const list = document.getElementById('toolbar-order-list');
  list.dispatch('click', { target: { closest: () => ({ dataset: { key: 'edit', dir: 'up' } }) } });
  assert.deepEqual(JSON.parse(stored.get(orderKey)).slice(0, 3), ['react', 'edit', 'reply']);
  document.getElementById('toolbar-order-reset-btn').dispatch('click');
  assert.deepEqual(JSON.parse(stored.get(orderKey)), defaults);
  assert.equal(stored.get(slotsKey), '5', 'the existing reset button resets the order');
});

test('explicitly saving three slots preserves the legacy order in the picker and renderer', () => {
  const { app, document } = setup(legacy, '4');
  const slider = document.getElementById('toolbar-visible-slots');
  slider.value = '3';
  // The fixture keeps children when innerHTML is cleared, so inspect the latest redraw.
  slider.dispatch('change');
  const rows = document.getElementById('toolbar-order-list').children.slice(-defaults.length);
  assert.deepEqual(rows.map(row => row.innerHTML.match(/data-key="([^"]+)"/)[1]), legacy);
  assert.deepEqual([...app._toolbarPreferences().order], legacy);
});

test('moving Edit back to its old position is an explicit choice even with three slots', () => {
  const { app, document, writes } = setup(legacy, '3');
  const list = document.getElementById('toolbar-order-list');
  for (let position = defaults.indexOf('edit'); position < legacy.indexOf('edit'); position++) {
    list.dispatch('click', { target: { closest: () => ({ dataset: { key: 'edit', dir: 'down' } }) } });
  }
  assert.deepEqual([...app._toolbarPreferences().order], legacy);
  assert.equal(writes.filter(key => key === 'haven-toolbar-migrated').length, 1);
});

test('message markup and picker share the order, reserving unavailable default slots only', () => {
  const custom = ['edit', 'quote', 'reply', 'react', ...defaults.slice(4)];
  for (const [order, author, visible, overflow] of [
    [legacy, 2, ['react', 'reply'], ['quote', 'thread']],
    [undefined, 1, ['react', 'reply', 'edit'], ['quote', 'thread', 'nsfw', 'delete']],
    [custom, 2, ['quote', 'reply', 'react'], ['thread']],
  ]) {
    const { app } = setup(order, '3');
    Object.assign(app, {
      user: { id: 1 }, _isImageUrl: () => false, _highlightGroups: () => true, _groupsWithPrevious: () => true,
      _renderReactions: () => '', _renderAttachmentTags: () => '', _selfDestructHtml: () => '', _silentTagHtml: () => '',
      _hasPerm: () => false, _canModerate: () => false, _stampGroupSource() {}, _fmtTime: () => '',
      _formatContent: () => '', _roleMenuText: () => '', _messageNsfwToolbarHtml: () => '<button data-action="nsfw"></button>',
    });
    const msg = app._createMessageEl({ user_id: author, username: 'member', content: 'hello' }, {});
    const toolbar = parseHtml(msg.innerHTML).find(node => node.attrs?.class === 'msg-toolbar');
    const [group, more] = toolbar.children;
    const keys = nodes => nodes.map(n => n.attrs['data-action']);
    assert.deepEqual(keys(group.children.filter(n => n.attrs.class !== 'msg-shift-delete')), visible);
    assert.equal(more.children[0].attrs.class, 'msg-toolbar-more-btn');
    assert.deepEqual(keys(more.children[1].children), overflow);
  }
});
