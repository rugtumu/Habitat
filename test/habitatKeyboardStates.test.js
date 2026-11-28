'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { makeDocument } = require('./fakeDom');
const { CSS: layout } = require('../plugins/HabitatLayout.plugin');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('Grafit shares the focus, disabled, pending and invalid states across surfaces', () => {
  const theme = read('themes/habitat-grafit.theme.css');
  const forms = read('public/css/style-forms.css');
  assert.match(theme, /html\[data-haven-theme-api="1"\] :focus-visible[^{]*\{\s*outline: \.125rem solid var\(--accent\) !important;\s*outline-offset: \.125rem/);
  const inset = theme.match(/html\[data-haven-theme-api="1"\] :is\((#quick-switcher-input,[^{]+)\):focus-visible \{([^}]+)\}/);
  assert.ok(inset, 'clipped fields have a focused inset rule');
  for (const selector of ['#thread-input', '#search-input', '#settings-search', '#gif-search-input', '.emoji-search-input',
    '.reaction-full-search-input', '#theme-search', '.modal', '[role="dialog"]', 'textarea']) assert.ok(inset[1].includes(selector), selector);
  assert.match(inset[2], /outline: \.0625rem solid var\(--hb-field-focus\) !important;/);
  assert.match(inset[2], /outline-offset: -\.125rem !important;/);
  assert.match(theme, /\[data-haven-region="composer"\]:focus-within \{\s*outline: \.0625rem solid var\(--hb-field-focus\);\s*outline-offset: -\.0625rem;/);
  for (const css of [theme, layout]) assert.doesNotMatch(css, /\boutline:\s*(?:0|none)\s*(?:!important\s*)?[;}]/);
  assert.match(theme, /:is\(:disabled, \[aria-disabled="true"\], \.disabled\) \{\s*opacity: var\(--hb-disabled-opacity\) !important;\s*cursor: default/);
  assert.match(theme, /\[aria-invalid="true"\] \{\s*border-color: var\(--hb-invalid-ring\)/);
  assert.match(theme, /\.field-error \{[^}]+color: var\(--danger\)/);
  assert.match(forms, /button\[aria-busy="true"\][^{]+::after \{\s*content: "…";\s*position: absolute/);
});

test('a refused profile name describes its field until edited and preserves its existing hint and toast', async () => {
  const doc = makeDocument();
  const field = doc.createElement('input'), button = doc.createElement('button');
  field.id = 'rename-input';
  button.id = 'save-rename-btn';
  field.value = '?';
  field.setAttribute('aria-describedby', 'name-hint');
  field.closest = () => null;
  field.after = el => doc.body.appendChild(el);
  doc.body.append(field, button);
  const context = vm.createContext({ document: doc, t: key => key });
  vm.runInContext(read('public/js/form-state.js'), context);
  const app = vm.runInContext(read('public/js/modules/app-people.js').replace('export default {', '({').replace(/};\s*$/, '})'), context);
  let toast;
  app._showToast = message => { toast = message; };
  await app._saveRename();
  assert.equal(field.getAttribute('aria-invalid'), 'true');
  assert.equal(field.getAttribute('aria-describedby'), 'name-hint rename-input-error');
  assert.equal(doc.getElementById('rename-input-error').textContent, toast);
  assert.equal(doc.activeElement, field);
  doc.listeners.input[0]({ target: field });
  assert.equal(field.getAttribute('aria-invalid'), null);
  assert.equal(field.getAttribute('aria-describedby'), 'name-hint');
  assert.equal(doc.getElementById('rename-input-error'), null);
});

// Extend the repository fixture only with the browser operations used by list navigation.
function navigation() {
  const doc = makeDocument();
  const observers = new Map();
  function element(tag) {
    const el = doc.createElement(tag);
    const simple = el._matches.bind(el);
    el._matches = selector => {
      if (selector.includes(' ')) return false;
      const parts = selector.match(/\[[^\]]+\]|[^\[]+/g);
      return parts.every(part => simple(part));
    };
    el.matches = selector => el._matches(selector);
    el.closest = selector => {
      for (let p = el; p; p = p.parentElement) if (p._matches(selector)) return p;
      return null;
    };
    el.contains = node => {
      for (let p = node; p; p = p.parentElement) if (p === el) return true;
      return false;
    };
    Object.defineProperties(el, {
      isConnected: { get: () => doc.body.children.some(list => list.contains(el)) },
      firstElementChild: { get: () => el.children[0] },
      lastElementChild: { get: () => el.children.at(-1) },
      nextElementSibling: { get: () => el.parentElement?.children[el.parentElement.children.indexOf(el) + 1] },
      previousElementSibling: { get: () => el.parentElement?.children[el.parentElement.children.indexOf(el) - 1] },
    });
    el.getBoundingClientRect = () => ({ left: 12, bottom: 32 });
    el.click = () => el.dispatch('click');
    el.dispatchEvent = event => el.dispatch(event.type, event);
    return el;
  }
  for (const id of ['channel-list', 'dm-list', 'online-users', 'messages']) {
    const list = element('div');
    list.id = id;
    list.tabIndex = 0;
    doc.body.appendChild(list);
  }
  const NodeFilter = { SHOW_ELEMENT: 1, FILTER_ACCEPT: 1, FILTER_REJECT: 2, FILTER_SKIP: 3 };
  doc.createTreeWalker = (root, _, filter) => {
    const visible = () => root.children.filter(el => filter.acceptNode(el) === NodeFilter.FILTER_ACCEPT);
    return {
      firstChild() { return visible()[0]; },
      lastChild() { return visible().at(-1); },
      nextSibling() { const rows = visible(); return rows[rows.indexOf(this.currentNode) + 1]; },
      previousSibling() { const rows = visible(); return rows[rows.indexOf(this.currentNode) - 1]; },
    };
  };
  class Observer {
    constructor(cb) { this.cb = cb; }
    observe(list) { observers.set(list, this.cb); }
    disconnect() {}
  }
  class MouseEvent {
    constructor(type, init) { this.type = type; Object.assign(this, init); }
  }
  vm.runInNewContext(read('public/js/list-navigation.js'), { document: doc, MutationObserver: Observer, NodeFilter,
    CSS: { escape: String }, window: { getSelection: () => ({ isCollapsed: true }) }, MouseEvent });
  return { doc, element, observers };
}

for (const [listId, attr] of [['channel-list', 'data-code'], ['dm-list', 'data-code'],
  ['online-users', 'data-user-id'], ['messages', 'data-msg-id']]) {
  test(listId + ' moves across visible rows, preserves shortcuts, invokes native actions and restores by identity', () => {
    const { doc, element, observers } = navigation();
    const list = doc.getElementById(listId);
    let clicks = 0, menus = 0;
    function row(id) {
      const el = element(listId === 'messages' ? 'li' : 'div');
      if (listId !== 'messages') el.setAttribute('role', 'listitem');
      el.setAttribute(attr, id);
      el.addEventListener('click', () => clicks++);
      el.addEventListener('contextmenu', e => { menus++; assert.equal(e.clientY, 32); });
      return el;
    }
    const a = row('a'), b = row('b'), c = row('c');
    b.style.display = 'none';
    list.append(a, b, c);
    list.dispatch('focusin');
    const key = (k, mods = {}) => list.dispatch('keydown', { key: k, target: doc.activeElement, ...mods });
    key('Home');
    assert.equal(doc.activeElement, a);
    assert.equal(key('ArrowDown', { altKey: true }).defaultPrevented, false);
    key('ArrowDown');
    assert.equal(doc.activeElement, c);
    assert.equal(a.tabIndex, -1);
    assert.equal(c.tabIndex, 0);
    key('ArrowUp');
    assert.equal(doc.activeElement, a);
    key('End');
    key('Enter');
    key('ContextMenu');
    key('F10', { shiftKey: true });
    assert.equal(menus, listId === 'messages' ? 3 : 2);
    assert.equal(clicks, listId === 'messages' ? 0 : 1);
    const fresh = row('c');
    list.replaceChildren(row('new'), fresh, row('a'));
    doc.activeElement = doc.body;
    observers.get(list)();
    assert.equal(doc.activeElement, fresh);
    assert.equal(fresh.tabIndex, 0);
    assert.equal(list.tabIndex, -1);
    assert.equal(key('x').defaultPrevented, false);
  });
}

test('message keys use the available toolbar action and never delete without asking', () => {
  const { doc, element } = navigation();
  const list = doc.getElementById('messages');
  const row = element('li');
  row.setAttribute('data-msg-id', '91');
  list.append(row);
  list.dispatch('focusin');
  const clicks = [];
  let editable = true;
  row.querySelector = selector => {
    const action = selector.match(/button\[data-action="(edit|reply|delete)"\]:not\(\[hidden\]\)/)?.[1];
    if (!action || (action === 'edit' && !editable)) return null;
    return { dispatchEvent: event => clicks.push([action, !!event.shiftKey]) };
  };
  function key(key, more = {}) {
    return list.dispatch('keydown', { key, target: row, ...more });
  }
  key('e');
  key('r');
  key('Delete');
  key('Delete', { shiftKey: true });
  editable = false;
  assert.equal(key('e').defaultPrevented, false);
  assert.equal(key('e', { target: element('textarea') }).defaultPrevented, false);
  // Shift+Delete is left alone: from the keyboard a deletion always asks first.
  assert.deepEqual(clicks, [['edit', false], ['reply', false], ['delete', false]]);
});

test('message names include the author and time and follow the visible excerpt', () => {
  const methods = vm.runInNewContext(read('public/js/modules/app-messages.js')
    .replace('export default {', '({').replace(/};\s*$/, '})'), { t: key => key });
  const row = makeDocument().createElement('li');
  row.localName = 'li';
  Object.assign(row.dataset, { username: 'Ada', timeShort: '08:15', rawContent: 'hello ||secret||!', userId: '1' });
  const label = () => { methods._labelMessageRow(row); return row.getAttribute('aria-label'); };
  assert.equal(label(), 'Ada, 08:15, hello …!');
  row.dataset.nsfw = '1';
  assert.equal(label(), 'Ada, 08:15, msg_toolbar.nsfw_hidden');
  row.dataset.nsfwShown = '1';
  row.dataset.burnSeconds = '30';
  assert.equal(label(), 'Ada, 08:15, messages.burn_reveal');
  row.dataset.burnStartedAt = '2026-01-22T08:15:00Z';
  assert.equal(label(), 'Ada, 08:15, hello …!');
  row.classList.add('message-burned');
  assert.equal(label(), 'Ada, 08:15, messages.burn_done');
});

test('a click on a row does not count as entering the list by keyboard', () => {
  const source = read('public/js/list-navigation.js');
  assert.match(source, /document\.addEventListener\('pointerdown', \(\) => \{ pointer = true;/);
  assert.match(source, /document\.addEventListener\('keydown', event => \{ pointer = false;/);
  const focusin = source.slice(source.indexOf("list.addEventListener('focusin'"), source.indexOf("list.addEventListener('focusout'"));
  assert.ok(focusin.indexOf('if (pointer) return;') > 0);
  assert.ok(focusin.indexOf('if (pointer) return;') < focusin.indexOf('select('));
});

test('signing in works without the form helper and never puts an error under a hidden field', () => {
  const auth = read('public/js/auth.js');
  assert.match(auth, /const Form = typeof HabitatForm !== 'undefined' \? HabitatForm/);
  assert.doesNotMatch(auth, /HabitatForm\./);
  assert.match(auth, /invalidField && Form\.invalid && invalidField\.getClientRects\(\)\.length/);
});
