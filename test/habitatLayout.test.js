'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { EventEmitter } = require('node:events');

const ROOT = path.join(__dirname, '..');
const FILE = 'HabitatLayout.plugin.js';
const source = fs.readFileSync(path.join(ROOT, 'plugins', FILE), 'utf8');
const HabitatLayout = require('../plugins/HabitatLayout.plugin.js');

// ── A DOM just large enough for the plugin ─────────────────
class FakeTarget {
  constructor() { this.listeners = new Map(); this.captured = new Set(); this.captureListeners = new WeakSet(); }
  addEventListener(type, listener, options) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
    if (options === true || options?.capture) { this.captured.add(type); this.captureListeners.add(listener); }
  }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
  listenerCount() { return [...this.listeners.values()].reduce((sum, set) => sum + set.size, 0); }
  fire(type, init = {}) {
    const event = { type, target: this, stopped: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, stopImmediatePropagation() { this.immediate = true; }, ...init };
    const listeners = [...(this.listeners.get(type) || [])];
    listeners.sort((a, b) => Number(this.captureListeners.has(b)) - Number(this.captureListeners.has(a)));
    for (const listener of listeners) {
      listener.call(this, event);
      if (event.immediate) break;
    }
    return event;
  }
}

class FakeStyle {
  constructor() { this.values = new Map(); }
  setProperty(property, value, priority = '') { this.values.set(property, { value, priority }); }
  removeProperty(property) { this.values.delete(property); }
  getPropertyValue(property) { return this.values.get(property)?.value || ''; }
  getPropertyPriority(property) { return this.values.get(property)?.priority || ''; }
  get display() { return this.getPropertyValue('display'); }
  set display(value) { this.setProperty('display', value); }
}

// Records what the plugin watches, and lets a test deliver a change by hand.
class FakeMutationObserver {
  constructor(callback) { this.callback = callback; this.targets = new Set(); }
  observe(target) { this.targets.add(target); FakeMutationObserver.live.add(this); }
  disconnect() { FakeMutationObserver.live.delete(this); this.targets.clear(); }
  static notify(target) {
    for (const observer of [...FakeMutationObserver.live]) if (observer.targets.has(target)) observer.callback([]);
  }
}
FakeMutationObserver.live = new Set();

function parseCompound(selector) {
  const out = { tag: null, id: null, classes: [], attrs: [] };
  let rest = selector.trim();
  const tag = rest.match(/^[a-zA-Z][\w-]*/);
  if (tag) { out.tag = tag[0].toLowerCase(); rest = rest.slice(tag[0].length); }
  const part = /^(?:#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:="([^"]*)")?\])/;
  while (rest) {
    const hit = rest.match(part);
    if (!hit) throw new Error(`Unsupported selector in test DOM: ${selector}`);
    if (hit[1]) out.id = hit[1]; else if (hit[2]) out.classes.push(hit[2]); else out.attrs.push([hit[3], hit[4]]);
    rest = rest.slice(hit[0].length);
  }
  return out;
}

class FakeElement extends FakeTarget {
  constructor(tag, doc) {
    super();
    this.tagName = tag.toLowerCase();
    this.ownerDocument = doc;
    this.parentNode = null;
    this.children = [];
    this.attributes = new Map();
    this.style = new FakeStyle();
    this.textContent = '';
    this.value = '';
    this.clientWidth = 0;
    this.clientHeight = 0;
  }
  get parentElement() { return this.parentNode; }
  get form() { return this.closest('form'); }
  get options() { return this.querySelectorAll('option'); }
  get value() {
    return this.getAttribute('type') === 'checkbox' ? this.getAttribute('value') ?? 'on' : this._value;
  }
  set value(value) {
    if (this.getAttribute('type') === 'checkbox') this.attributes.set('value', value);
    else this._value = value;
  }
  reset() {
    for (const input of this.querySelectorAll('input, select')) {
      if (input.matches('input[type="checkbox"]')) input.checked = input.hasAttribute('checked');
      else input.value = input.getAttribute('value') || '';
    }
  }
  dispatchEvent(event) { this.fire(event.type); }
  replaceChildren(...children) {
    for (const node of [...this.children]) node.remove();
    for (const node of children) this.appendChild(node);
  }
  get nextSibling() {
    if (!this.parentNode) return null;
    return this.parentNode.children[this.parentNode.children.indexOf(this) + 1] || null;
  }
  get id() { return this.getAttribute('id') || ''; }
  // data-user-id reads as dataset.userId, as in a browser.
  get dataset() {
    return new Proxy({}, { get: (_, key) => this.attributes.get(`data-${String(key).replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`) });
  }
  get hidden() { return this.attributes.has('hidden'); }
  set hidden(value) { if (value) this.attributes.set('hidden', ''); else this.attributes.delete('hidden'); }
  get title() { return this.attributes.get('title') || ''; }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === 'value') this.value = String(value);
    if (name === 'tabindex') this.tabIndex = Number(value);
  }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  hasAttribute(name) { return this.attributes.has(name); }
  removeAttribute(name) { this.attributes.delete(name); }
  insertBefore(node, reference) {
    if (reference && reference.parentNode !== this) throw new Error('Invalid insertion reference');
    node.remove();
    const index = reference ? this.children.indexOf(reference) : this.children.length;
    this.children.splice(index, 0, node);
    node.parentNode = this;
    return node;
  }
  appendChild(node) { return this.insertBefore(node, null); }
  prepend(node) { return this.insertBefore(node, this.children[0] || null); }
  remove() {
    if (!this.parentNode) return;
    this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1);
    this.parentNode = null;
  }
  contains(node) {
    for (let current = node; current; current = current.parentNode) if (current === this) return true;
    return false;
  }
  focus() { this.ownerDocument.activeElement = this; }
  click() { this.fire('click'); }
  getClientRects() { return this.hidden || this.style.display === 'none' ? [] : [{}]; }
  getBoundingClientRect() { return { top: 0, right: 40, width: 40, height: 40 }; }
  matches(selector) {
    return selector.split(',').some((single) => {
      const want = parseCompound(single);
      if (want.tag && want.tag !== this.tagName) return false;
      if (want.id && want.id !== this.getAttribute('id')) return false;
      const classes = (this.getAttribute('class') || '').split(/\s+/);
      if (!want.classes.every((name) => classes.includes(name))) return false;
      return want.attrs.every(([name, value]) => this.hasAttribute(name)
        && (value === undefined || this.getAttribute(name) === value));
    });
  }
  closest(selector) {
    for (let current = this; current; current = current.parentNode) {
      if (current.matches?.(selector)) return current;
    }
    return null;
  }
  descendants() { return this.children.flatMap((child) => [child, ...child.descendants()]); }
  querySelectorAll(selector) {
    const found = new Set();
    for (const single of selector.split(',').map((s) => s.trim())) {
      const scoped = single.match(/^:scope\s*>\s*(.+)$/);
      if (scoped) {
        for (const node of this.children) if (node.matches(scoped[1])) found.add(node);
        continue;
      }
      // "a b": b anywhere under a. Spaces inside [title="..."] are not combinators.
      const steps = single.split(/\s+(?![^[]*\])/);
      const last = steps.pop();
      for (const node of this.descendants()) {
        if (!node.matches(last)) continue;
        let anchor = node.parentNode;
        const inside = [...steps].reverse().every((step) => {
          while (anchor && !anchor.matches?.(step)) anchor = anchor.parentNode;
          const hit = !!anchor;
          anchor = anchor?.parentNode;
          return hit;
        });
        if (inside) found.add(node);
      }
    }
    return selector.includes(',') ? this.descendants().filter(node => found.has(node)) : [...found];
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

class FakeDocument extends FakeTarget {
  constructor() {
    super();
    this.documentElement = new FakeElement('html', this);
    this.documentElement.lang = 'en';
    this.body = new FakeElement('body', this);
    this.body.classList = { contains: name => this.body.matches('.' + name) };
    this.documentElement.appendChild(this.body);
    this.activeElement = null;
  }
  createElement(tag) { return new FakeElement(tag, this); }
  createElementNS(namespace, tag) { return new FakeElement(tag, this); }
  querySelectorAll(selector) { return this.documentElement.querySelectorAll(selector); }
  querySelector(selector) { return this.documentElement.querySelector(selector); }
  getElementById(id) { return this.querySelector(`#${id}`); }
}

class FakeMedia extends FakeTarget {
  constructor(matches) { super(); this.matches = matches; }
  set(matches) { this.matches = matches; this.fire('change'); }
}

function el(doc, tag, attributes = {}, children = []) {
  const node = doc.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  for (const child of children) node.appendChild(child);
  return node;
}

function region(doc, name, children = [], tag = 'div') {
  return el(doc, tag, { 'data-haven-region': name }, children);
}

// The parts of app.html the layout touches, in their native order.
function buildApp({ desktop = true, phone = false, lang = 'en', layoutOn = '1', foldSetting = null } = {}) {
  const doc = new FakeDocument();
  doc.documentElement.lang = lang;
  const button = (id, title) => el(doc, 'button', title ? { id, title } : { id });
  const account = region(doc, 'account', [
    el(doc, 'button', { id: 'user-bar-avatar' }),
    el(doc, 'div', { class: 'user-names' }, [el(doc, 'span', { id: 'current-user' })]),
    button('user-status-btn', 'Set status'),
    button('mentions-btn', 'Mentions and replies'),
    button('rename-btn', 'Change display name'),
    button('logout-btn', 'Logout')
  ]);
  const header = el(doc, 'div', { id: 'sidebar-header' }, [el(doc, 'div', { id: 'brand' }), account]);
  const input = (id, type = 'text', attrs = {}) => el(doc, 'input', { id, type, ...attrs });
  const row = (id, children) => el(doc, 'div', id ? { id } : {}, children);
  const switchRow = (name, title = '') => el(doc, 'label', {
    class: 'checkbox-row', title, ...(name === 'add-all' ? { id: 'new-channel-add-all-row' } : {})
  }, [input('new-channel-' + name, 'checkbox'), el(doc, 'span')]);
  const join = region(doc, 'join-channel', [el(doc, 'h5'), row('join-section-body', [
    row(null, [input('channel-code-input'), button('join-channel-btn')])
  ])]);
  const create = region(doc, 'create-channel', [el(doc, 'h5'), row('create-section-body', [
    row('new-channel-template-row', [el(doc, 'select', { id: 'new-channel-template' }), button('new-channel-template-del')]),
    row(null, [input('new-channel-name'), button('create-channel-btn')]),
    switchRow('private'), switchRow('temporary', 'Auto-deletes when empty'), switchRow('forum'), switchRow('add-all'),
    el(doc, 'details', { id: 'new-channel-more' }, [
      el(doc, 'summary'), input('new-channel-topic'), switchRow('readonly'),
      el(doc, 'label', { class: 'checkbox-row' }, [el(doc, 'select', { id: 'new-channel-slowmode' }, [el(doc, 'option', { value: '0' })])]),
      switchRow('text'), switchRow('media'), switchRow('voice'), el(doc, 'small')
    ]),
    row('temp-channel-duration-row', [input('new-channel-duration', 'number', { value: '24' })])
  ])]);
  const channels = region(doc, 'channels', [el(doc, 'h5', { id: 'channels-toggle' }), el(doc, 'div', { id: 'channel-list' })]);
  channels.setAttribute('id', 'channels-pane');
  const badge = el(doc, 'span', { id: 'dm-unread-badge' });
  const dms = region(doc, 'direct-messages', [badge, el(doc, 'div', { id: 'dm-list' })]);
  dms.setAttribute('id', 'dm-pane');
  const split = el(doc, 'div', { id: 'sidebar-split' }, [channels, el(doc, 'div', { class: 'sidebar-split-handle' }), dms]);
  const content = region(doc, 'sidebar-content', [el(doc, 'div', { id: 'mobile-servers-row' }, [button('mobile-srv-add-btn')]), join, create, split]);
  const rail = region(doc, 'server-rail', [el(doc, 'div', { id: 'home-server' }), region(doc, 'server-list'),
    button('add-server-btn', 'Add Server'), button('manage-servers-btn', 'Manage Servers'), button('sync-servers-btn', 'Sync Server List')]);
  const actions = region(doc, 'sidebar-actions', [
    button('theme-popup-toggle', 'Theme'),
    button('activities-btn', 'Activities'),
    el(doc, 'span'),
    button('voice-mute-btn', 'Mute'),
    button('voice-deafen-btn', 'Deafen')
  ]);
  // Haven draws the voice bar only during a call; outside one it is hidden and empty.
  const voiceBar = el(doc, 'div', { id: 'voice-bar' });
  voiceBar.style.display = 'none';
  const footer = region(doc, 'sidebar-footer', [el(doc, 'div', { id: 'theme-popup' }), voiceBar, actions]);
  const navigation = region(doc, 'navigation-sidebar', [header, content, footer], 'aside');
  const voiceControls = region(doc, 'voice-controls', [button('voice-leave-sidebar-btn', 'Disconnect')]);
  voiceControls.style.setProperty('position', 'absolute');
  const context = region(doc, 'context-sidebar', [
    region(doc, 'voice-roster'),
    region(doc, 'member-list'),
    region(doc, 'voice-settings'),
    voiceControls,
    el(doc, 'div', { id: 'settings-panel' }, [button('open-settings-btn', 'Settings')])
  ], 'aside');
  doc.body.appendChild(el(doc, 'div', { id: 'app' }, [rail, navigation, region(doc, 'main'), context]));
  // The member's own "fold the message box buttons" setting, when the test wants one.
  if (foldSetting !== null) {
    const setting = el(doc, 'input', { id: 'compact-composer', type: 'checkbox' });
    setting.checked = foldSetting;
    doc.body.appendChild(setting);
  }

  const media = new FakeMedia(desktop);
  const phoneMedia = new FakeMedia(phone);
  const composerRefreshes = [];
  const data = new Map([['HabitatLayout/layoutOn', layoutOn]]);
  const styles = new Set();
  const api = {
    DOM: {
      addStyle(id) { styles.add(id); },
      removeStyle(id) { styles.delete(id); },
      query(selector) { return doc.querySelector(selector); }
    },
    Data: {
      load(plugin, key, fallback) { return data.get(`${plugin}/${key}`) ?? fallback; },
      save(plugin, key, value) { data.set(`${plugin}/${key}`, value); }
    },
    Layout: {
      owner: null,
      acquire(owner) {
        if (this.owner && this.owner !== owner) return false;
        this.owner = owner;
        return true;
      },
      release(owner) { if (this.owner === owner) this.owner = null; }
    }
  };
  globalThis.document = doc;
  globalThis.window = {
    innerWidth: phone ? 375 : 1440, innerHeight: 900,
    matchMedia(query) { return /max-width:\s*768px/.test(query) ? phoneMedia : media; },
    app: { _applyComposerButtons() { composerRefreshes.push(doc.documentElement.hasAttribute('data-compact-composer')); } }
  };
  globalThis.HavenApi = api;
  globalThis.MutationObserver = FakeMutationObserver;
  // Nothing is laid out here; a test that measures the call stage supplies its own.
  globalThis.getComputedStyle = () => ({});
  const call = (on) => {
    voiceBar.style.display = on ? 'flex' : 'none';
    if (on && !voiceBar.children.length) voiceBar.appendChild(el(doc, 'div', { id: 'voice-bar-top' }));
    if (!on) for (const child of [...voiceBar.children]) child.remove();
    FakeMutationObserver.notify(voiceBar);
  };
  return { doc, rail, split, dms, badge, media, phoneMedia, composerRefreshes, voiceBar, call, data, styles, api, account, header, footer, actions, join, create, channels, context, voiceControls };
}

function snapshot(node) {
  const attributes = [...node.attributes].map(([name, value]) => `${name}=${value}`).sort().join(' ');
  return `<${node.tagName} ${attributes}>${node.children.map(snapshot).join('')}</${node.tagName}>`;
}

function habitatMarks(doc) {
  return doc.documentElement.descendants()
    .concat(doc.documentElement)
    .flatMap((node) => [...node.attributes.keys()].filter((name) => name.startsWith('data-habitat-')));
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

test.afterEach(() => {
  delete globalThis.document;
  delete globalThis.getComputedStyle;
  delete globalThis.window;
  delete globalThis.HavenApi;
  delete globalThis.MutationObserver;
  FakeMutationObserver.live.clear();
});

// ── Tests ──────────────────────────────────────────────────
test('the Layout picker can list and drive the Habitat layout', () => {
  assert.match(FILE, /Layout\.plugin\.js$/);
  assert.match(source, /@name Habitat Layout/);
  assert.equal(typeof HabitatLayout.prototype._engage, 'function');
  assert.equal(typeof HabitatLayout.prototype._disengage, 'function');
  assert.match(source, /Layout\.acquire\('HabitatLayout'\)/);
  assert.match(source, /Data\.save\('HabitatLayout', 'layoutOn', '1'\)/);
  assert.match(source, /Data\.save\('HabitatLayout', 'layoutOn', '0'\)/);
});

test('on a desktop the account, call controls and settings sit bottom-left', () => {
  const app = buildApp();
  const plugin = new HabitatLayout();
  plugin.start();

  assert.equal(app.api.Layout.owner, 'HabitatLayout');
  assert.equal(app.doc.documentElement.getAttribute('data-habitat-layout'), 'desktop');
  assert.equal(app.doc.documentElement.getAttribute('data-habitat-layout-desktop'), '1');
  assert.equal(app.account.parentNode, app.footer);
  assert.equal(app.footer.children.at(-1), app.account, 'the account bar is the last thing in the footer');
  assert.equal(app.voiceControls.parentNode, app.footer);
  assert.ok(app.footer.children.indexOf(app.voiceControls) < app.footer.children.indexOf(app.account));
  assert.equal(app.voiceControls.style.getPropertyValue('position'), 'static');

  const tools = app.account.querySelector('[data-habitat-tools]');
  assert.deepEqual(tools.children.map((node) => node.getAttribute('id')),
    ['voice-mute-btn', 'voice-deafen-btn', 'open-settings-btn']);
  assert.ok(app.doc.getElementById('settings-panel').hasAttribute('data-habitat-emptied'));
  assert.ok(app.account.contains(app.doc.getElementById('mentions-btn')), 'mentions stay on the account bar');
  plugin.stop();
});

test('nothing leaves the sidebar without staying reachable', () => {
  const app = buildApp();
  const plugin = new HabitatLayout();
  plugin.start();

  const menu = app.header.querySelector('[data-habitat-menu]');
  assert.ok(menu.hidden, 'the menu starts closed');
  for (const id of ['theme-popup-toggle', 'activities-btn']) {
    assert.ok(menu.contains(app.doc.getElementById(id)), `${id} is in the server menu`);
  }
  const accountMenu = app.account.querySelector('[data-habitat-menu="account"]');
  assert.deepEqual(accountMenu.children.map(el => el.id), ['rename-btn', 'logout-btn']);
  assert.ok(app.account.contains(app.doc.getElementById('user-status-btn')));
  const body = app.doc.querySelector('[data-habitat-dialog-body]');
  assert.deepEqual(body.children, [app.join, app.create]);
  assert.ok(app.channels.querySelector('[data-habitat-add-button]'), 'the channel list offers the + button');
  plugin.stop();
});

test('switching the layout off puts every element back where it was', () => {
  const app = buildApp();
  const before = snapshot(app.doc.documentElement);
  app.doc.documentElement.setAttribute('data-habitat-boot', 'desktop');
  const plugin = new HabitatLayout();
  plugin.start();
  assert.notEqual(snapshot(app.doc.documentElement), before);
  assert.equal(app.doc.documentElement.hasAttribute('data-habitat-boot'), false);

  plugin._disengage();
  assert.equal(snapshot(app.doc.documentElement), before);
  assert.deepEqual(habitatMarks(app.doc), []);
  assert.equal(app.voiceControls.style.getPropertyValue('position'), 'absolute');
  assert.equal(app.api.Layout.owner, null);
  assert.equal(app.data.get('HabitatLayout/layoutOn'), '0');

  plugin._engage();
  assert.equal(app.data.get('HabitatLayout/layoutOn'), '1');
  plugin.stop();
  assert.equal(snapshot(app.doc.documentElement), before);
  assert.equal(app.doc.listenerCount(), 0, 'stop() leaves no document listeners behind');
  assert.equal(app.media.listenerCount(), 0);
  assert.equal(app.phoneMedia.listenerCount(), 0);
  assert.equal(app.styles.size, 0);
  assert.equal(app.data.get('HabitatLayout/layoutOn'), '1', 'stop() does not change the saved choice');
});

for (const [shape, options] of [
  ['desktop', { desktop: true }], ['tablet', { desktop: false }], ['phone', { desktop: false, phone: true }]
]) {
  test(`Messages switches the sidebar and restores the native ${shape} navigation`, () => {
    const { doc, rail, split, dms, badge, api } = buildApp(options);
    const title = el(doc, 'h3', { id: 'channel-header-name' });
    doc.body.appendChild(title);
    doc.body.appendChild(region(doc, 'message-list'));
    let searches = 0;
    window.app._openQuickSwitcher = () => { searches++; };
    api.currentChannel = 'general';
    badge.textContent = '3';
    const before = snapshot(doc.documentElement);
    const layout = new HabitatLayout();
    layout.start();

    const inbox = doc.querySelector('[data-habitat-inbox]');
    const nav = doc.querySelector('[data-habitat-nav]');
    const home = doc.getElementById('home-server');
    assert.equal(inbox.parentNode, options.desktop ? rail : nav);
    assert.equal(inbox.getAttribute('aria-controls'), dms.id);
    assert.equal(doc.querySelector('[data-habitat-lists], [data-habitat-inbox-page]'), null);
    const state = name => {
      assert.equal(split.getAttribute('data-habitat-list'), name);
      assert.equal(inbox.getAttribute('aria-pressed'), String(name === 'messages'));
    };
    state('channels');
    inbox.fire('click');
    state('messages');
    assert.equal(api.currentChannel, 'general', 'browsing messages leaves the conversation alone');
    assert.equal(inbox.querySelector('[data-habitat-count]').textContent, '3');
    nav.querySelector('[data-habitat-jump]').fire('click');
    assert.equal(searches, 1);
    FakeMutationObserver.notify(title);
    state('messages');
    inbox.fire('click');
    state('channels');
    api.currentChannel = 'dm';
    doc.body.setAttribute('class', 'viewing-dm');
    FakeMutationObserver.notify(title);
    state('messages');
    badge.style.display = 'none';
    FakeMutationObserver.notify(badge);
    assert.equal(inbox.querySelector('[data-habitat-count]').textContent, '');
    home.fire('click');
    state('channels');
    inbox.fire('click');
    state('messages');
    doc.body.removeAttribute('class');
    api.currentChannel = 'general';
    FakeMutationObserver.notify(title);
    state('channels');
    layout.stop();
    assert.equal(snapshot(doc.documentElement), before);
    assert.equal(FakeMutationObserver.live.size, 0);
  });
}

test('guests stay on channels and the Messages button is hidden in both shapes', () => {
  const { doc, split, media } = buildApp();
  doc.body.setAttribute('class', 'is-guest');
  const layout = new HabitatLayout();
  layout.start();
  for (const desktop of [true, false]) {
    media.set(desktop);
    doc.querySelector('[data-habitat-inbox]').fire('click');
    assert.equal(split.getAttribute('data-habitat-list'), 'channels');
  }
  assert.match(HabitatLayout.CSS, /body\.is-guest \[data-habitat-inbox\] \{ display: none; \}/);
  layout.stop();
});

test('a saved "off" choice is respected on start', () => {
  const app = buildApp({ layoutOn: '0' });
  const before = snapshot(app.doc.documentElement);
  const plugin = new HabitatLayout();
  plugin.start();
  assert.equal(snapshot(app.doc.documentElement), before);
  assert.equal(app.api.Layout.owner, null);
  plugin.stop();
});

test('on a tablet or phone the sidebar is tidied inside Haven\'s own drawer', () => {
  const app = buildApp({ desktop: false });
  const before = snapshot(app.doc.documentElement);
  const plugin = new HabitatLayout();
  plugin.start();

  assert.equal(app.doc.documentElement.getAttribute('data-habitat-layout'), 'compact');
  assert.equal(app.doc.documentElement.hasAttribute('data-habitat-layout-desktop'), false);
  assert.equal(app.footer.children.at(-1), app.account, 'the account bar closes the drawer');
  assert.deepEqual(app.doc.querySelector('[data-habitat-dialog-body]').children, [app.join, app.create],
    'the forms that left room for one channel are behind the + button');
  assert.ok(app.header.querySelector('[data-habitat-menu]').contains(app.actions));
  assert.equal(app.voiceControls.parentNode, app.context, 'the call controls stay in the members drawer');
  assert.equal(app.voiceControls.style.getPropertyValue('position'), 'absolute');

  plugin._disengage();
  assert.equal(snapshot(app.doc.documentElement), before);
  plugin.stop();
});

test('crossing the desktop breakpoint swaps one shape for the other cleanly', () => {
  const app = buildApp({ desktop: true });
  const before = snapshot(app.doc.documentElement);
  const plugin = new HabitatLayout();
  plugin.start();
  assert.equal(app.voiceControls.parentNode, app.footer);

  app.media.set(false);
  assert.equal(app.doc.documentElement.getAttribute('data-habitat-layout'), 'compact');
  assert.equal(app.voiceControls.parentNode, app.context);
  assert.equal(app.account.parentNode, app.footer);
  assert.equal(app.doc.querySelectorAll('[data-habitat-menu]').length, 3, 'nothing is built twice');
  assert.equal(app.doc.querySelectorAll('[data-habitat-dialog]').length, 1);

  app.media.set(true);
  assert.equal(app.doc.documentElement.getAttribute('data-habitat-layout'), 'desktop');
  assert.equal(app.voiceControls.parentNode, app.footer);
  assert.equal(app.api.Layout.owner, 'HabitatLayout');

  plugin.stop();
  assert.equal(snapshot(app.doc.documentElement), before);
});

test('at phone width the message box tools fold into one button, and unfold again', () => {
  const app = buildApp({ desktop: false, phone: true });
  const root = app.doc.documentElement;
  const plugin = new HabitatLayout();
  plugin.start();
  assert.ok(root.hasAttribute('data-compact-composer'), 'eight tools leave no room to type on a phone');
  assert.deepEqual(app.composerRefreshes, [true], 'the app re-places the buttons for the folded mode');

  app.phoneMedia.set(false);
  assert.equal(root.hasAttribute('data-compact-composer'), false, 'a tablet has room for the tools');
  assert.deepEqual(app.composerRefreshes, [true, false]);

  app.phoneMedia.set(true);
  plugin._disengage();
  assert.equal(root.hasAttribute('data-compact-composer'), false, 'switching the layout off hands the composer back');
  plugin.stop();
});

test('the composer goes back to what the member chose, not simply to unfolded', () => {
  const app = buildApp({ desktop: false, phone: true, foldSetting: true });
  const root = app.doc.documentElement;
  root.setAttribute('data-compact-composer', '');
  const plugin = new HabitatLayout();
  plugin.start();
  plugin._disengage();
  assert.ok(root.hasAttribute('data-compact-composer'), 'a member who folds the tools everywhere keeps them folded');
  plugin.stop();
});

test('the desktop composer is never folded by the layout', () => {
  const app = buildApp({ desktop: true, phone: false });
  const plugin = new HabitatLayout();
  plugin.start();
  assert.equal(app.doc.documentElement.hasAttribute('data-compact-composer'), false);
  assert.deepEqual(app.composerRefreshes, [false], 'the native toolbar refreshes with the Habitat defaults');
  plugin.stop();
});

test('Mod Mode gets the native layout while it edits', () => {
  const app = buildApp();
  const before = snapshot(app.doc.body);
  const plugin = new HabitatLayout();
  plugin.start();

  app.doc.documentElement.setAttribute('data-haven-layout-editing', '1');
  app.doc.fire('haven:layout-editing', { detail: { active: true, owner: 'HabitatLayout' } });
  assert.equal(snapshot(app.doc.body), before);
  assert.equal(app.doc.documentElement.hasAttribute('data-habitat-layout-desktop'), false);

  app.doc.documentElement.removeAttribute('data-haven-layout-editing');
  app.doc.fire('haven:layout-editing', { detail: { active: false, owner: 'HabitatLayout' } });
  assert.equal(app.account.parentNode, app.footer);
  plugin.stop();
});

test('another layout plugin that owns the layout is not disturbed', () => {
  const app = buildApp();
  app.api.Layout.owner = 'BraidLayout';
  const before = snapshot(app.doc.documentElement);
  const plugin = new HabitatLayout();
  plugin.start();
  assert.equal(snapshot(app.doc.documentElement), before);
  assert.equal(app.api.Layout.owner, 'BraidLayout');

  app.api.Layout.owner = null;
  app.doc.fire('haven:layout-owner-change', { detail: { owner: null } });
  assert.equal(app.api.Layout.owner, 'HabitatLayout');
  assert.equal(app.account.parentNode, app.footer);
  plugin.stop();
});

test('a missing public region leaves the page untouched instead of half moved', () => {
  const app = buildApp();
  app.footer.remove();
  const before = snapshot(app.doc.documentElement);
  const plugin = new HabitatLayout();
  const warn = console.warn;
  console.warn = () => {};
  try { plugin.start(); } finally { console.warn = warn; }
  assert.equal(snapshot(app.doc.documentElement), before);
  assert.equal(app.api.Layout.owner, null);
  plugin.stop();
});

test('Escape in the open Habitat server menu leaves Settings and the thread underneath it', () => {
  const { doc, header } = buildApp();
  const settings = el(doc, 'div', { class: 'modal-overlay' });
  doc.body.appendChild(settings);
  doc.body.appendChild(el(doc, 'div', { id: 'thread-panel' }));
  const ui = fs.readFileSync(path.join(ROOT, 'public/js/modules/app-ui.js'), 'utf8').replace(/^import .*;$/mg, '');
  const app = Function(ui.replace('export default', 'return'))();
  let reads = 0;
  app._markAllRead = () => reads++;
  app.socket = { connected: true };
  app._closeThread = () => assert.fail('closed the thread under the menu');
  app._bindEscapeShortcuts();
  const plugin = new HabitatLayout();
  plugin.start();
  const menu = header.querySelector('[data-habitat-menu]');
  header.querySelector('[data-habitat-menu-button]').click();
  doc.fire('keydown', { key: 'Escape', shiftKey: true });
  assert.equal(reads, 1);
  assert.equal(menu.hidden, false);
  const key = doc.fire('keydown', { key: 'Escape' });
  assert.ok(key.immediate && menu.hidden);
  assert.notEqual(settings.style.display, 'none');
  doc.fire('keydown', { key: 'Escape' });
  assert.equal(settings.style.display, 'none');
  plugin.stop();
});

test('server menu rows keep their names while the tooltip code holds the title', async () => {
  const app = buildApp();
  const plugin = new HabitatLayout();
  plugin.start();
  const menu = app.header.querySelector('[data-habitat-menu]');
  const toggle = app.header.querySelector('[data-habitat-menu-button]');
  const theme = app.doc.getElementById('theme-popup-toggle');

  toggle.fire('click');
  assert.equal(menu.hidden, false);
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(theme.getAttribute('data-habitat-label'), 'Theme');

  // What the app's tooltip does on hover: title off, aria-label on.
  toggle.fire('click');
  theme.removeAttribute('title');
  theme.setAttribute('aria-label', 'Tema');
  toggle.fire('click');
  assert.equal(theme.getAttribute('data-habitat-label'), 'Tema');

  menu.fire('click', { target: theme });
  await tick();
  assert.ok(menu.hidden, 'choosing a row closes the menu');

  toggle.fire('click');
  app.doc.fire('pointerdown', { target: app.channels });
  assert.ok(menu.hidden, 'a press outside closes the menu');
  plugin.stop();
});

// Use Haven's actual template application and submit handlers. Only the transport
// is simulated, so requests and server replies can be asserted independently.
function channelDialog({ canCreate = true, prepare, ...options } = {}) {
  const app = buildApp(options);
  const byId = id => app.doc.getElementById(id);
  app.create.style.display = canCreate ? 'block' : 'none';
  const socket = Object.assign(new EventEmitter(), { connected: true });
  function methods(file) {
    const source = fs.readFileSync(path.join(ROOT, 'public/js/modules', file), 'utf8');
    return Function('t', source.replace('export default', 'return'))(key => key);
  }
  const toasts = [];
  const haven = Object.assign(window.app, methods('app-role-tools.js'), methods('app-channel-menu.js'),
    methods('app-socket-channels.js'), {
      socket, user: { id: 17, isAdmin: canCreate }, _escapeHtml: x => x, channels: [],
      _revertPendingChannelToggle() {}, _restoreRefusedDraft() {}, switchChannel() {},
      _showToast: (msg, type) => toasts.push({ msg, type })
    });
  haven._listenChannelsAndMessages();
  haven._listenPresenceAndVoice();
  haven._renderChannelTemplates();
  haven._bindChannelForms();
  prepare?.(byId, haven);
  const before = snapshot(app.doc.documentElement);
  const plugin = new HabitatLayout();
  plugin.start();
  haven._renderChannels = () => {};
  const add = app.channels.querySelector('[data-habitat-add-button]');
  const dialog = app.doc.querySelector('[data-habitat-dialog]');
  add.click();
  const create = byId('habitat-panel-create'), join = byId('habitat-panel-join');
  return { ...app, plugin, socket, dialog, add, byId, create, join, before, toasts,
    createTab: byId('habitat-tab-create'), joinTab: byId('habitat-tab-join'),
    name: byId('new-channel-name'), code: byId('channel-code-input') };
}

test('Create opens first with keyboard tabs, template cards and the original advanced controls', () => {
  const a = channelDialog();
  const { doc, dialog, byId, create, join } = a;
  assert.equal(doc.activeElement, a.name);
  assert.equal(a.createTab.getAttribute('aria-selected'), 'true');
  assert.ok(join.hidden && !create.hidden);
  const tabs = dialog.querySelector('[role="tablist"]');
  tabs.fire('keydown', { key: 'ArrowRight', target: a.createTab });
  assert.ok(create.hidden && !join.hidden);
  assert.equal(doc.activeElement, a.joinTab);
  tabs.fire('keydown', { key: 'ArrowLeft', target: a.joinTab });
  const group = create.querySelector('[role="radiogroup"]');
  const [chat, voice] = group.querySelectorAll('[role="radio"]');
  const template = byId('new-channel-template');
  assert.equal(template.value, 'b:chat');
  assert.equal(chat.getAttribute('aria-checked'), 'true');
  group.fire('keydown', { key: 'ArrowRight', target: chat });
  assert.equal(doc.activeElement, voice);
  assert.equal(template.value, 'b:voice_room');
  assert.equal(voice.getAttribute('aria-checked'), 'true');
  assert.equal(byId('new-channel-text').checked, false);
  assert.equal(byId('new-channel-media').checked, false);
  assert.equal(byId('new-channel-voice').checked, true);
  assert.equal(create.querySelector('[type="submit"]').textContent, 'Create room');
  const options = byId('habitat-channel-options');
  assert.ok(options.hidden);
  const toggle = create.querySelector('[data-habitat-advanced]');
  toggle.click();
  assert.ok(!options.hidden);
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  for (const id of ['new-channel-template', 'new-channel-template-del', 'new-channel-temporary',
    'new-channel-duration', 'new-channel-forum', 'new-channel-add-all', 'new-channel-topic',
    'new-channel-readonly', 'new-channel-slowmode', 'new-channel-text', 'new-channel-media', 'new-channel-voice']) {
    assert.ok(options.contains(byId(id)), id);
  }
  assert.ok(!options.contains(byId('new-channel-private')) && create.contains(byId('new-channel-private')));
  template.value = 'b:announcements';
  template.fire('change');
  assert.equal(voice.getAttribute('aria-checked'), 'false');
  assert.equal(chat.getAttribute('aria-checked'), 'false');
  assert.ok(byId('new-channel-readonly').checked);
  a.name.value = 'draft';
  const escape = doc.fire('keydown', { key: 'Escape' });
  assert.ok(dialog.hidden && escape.immediate);
  assert.equal(doc.activeElement, a.add);
  a.add.click();
  assert.equal(template.value, 'b:chat');
  assert.equal(a.name.value, '');
  assert.ok(options.hidden && join.hidden);
  a.plugin._disengage();
  assert.equal(snapshot(doc.documentElement), a.before);
  a.plugin.stop();
});

test('members without create permission only see Join, including after permissions change', () => {
  const a = channelDialog({ canCreate: false, desktop: false, phone: true, lang: 'tr' });
  assert.equal(a.add.getAttribute('aria-label'), 'Kanal ekle');
  assert.ok(a.createTab.hidden && a.create.hidden && !a.joinTab.hidden && !a.join.hidden);
  assert.equal(a.doc.activeElement, a.code);
  a.dialog.querySelector('[role="tablist"]').fire('keydown', { key: 'ArrowLeft', target: a.joinTab });
  assert.equal(a.doc.activeElement, a.joinTab);
  a.join.fire('submit');
  assert.equal(a.doc.activeElement, a.code);
  assert.equal(a.join.querySelector('[role="alert"]').textContent, 'Bir kanal kodu gir.');
  const close = a.dialog.querySelector('[data-habitat-dialog-close]');
  const submit = a.join.querySelector('[type="submit"]');
  submit.focus();
  assert.ok(a.doc.fire('keydown', { key: 'Tab' }).defaultPrevented);
  assert.equal(a.doc.activeElement, close);
  a.doc.fire('keydown', { key: 'Tab', shiftKey: true });
  assert.equal(a.doc.activeElement, submit);
  close.click();
  assert.equal(a.doc.activeElement, a.add);
  const gate = a.doc.querySelector('[data-haven-region="create-channel"]');
  gate.style.display = 'block';
  a.add.click();
  assert.equal(a.doc.activeElement, a.name);
  gate.style.display = 'none';
  FakeMutationObserver.notify(gate);
  assert.ok(a.create.hidden && a.createTab.hidden);
  assert.equal(a.doc.activeElement, a.code);
  a.plugin.stop();
});

test('a refused create keeps the settings for retry and only the creator’s matching success closes it', () => {
  const a = channelDialog();
  const calls = [];
  a.socket.on('create-channel', data => calls.push(data));
  a.create.querySelectorAll('[role="radio"]')[1].click();
  a.name.value = 'studio';
  a.create.fire('submit');
  a.create.fire('submit');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'studio');
  assert.equal(calls[0].textEnabled, false);
  const submit = a.create.querySelector('[type="submit"]');
  assert.ok(submit.disabled && !a.dialog.hidden);
  assert.equal(submit.textContent, 'Creating…');
  a.socket.emit('channel-created', { name: 'studio', created_by: 21 });
  a.socket.emit('error-msg', 'Message not found');
  assert.ok(submit.disabled);
  const error = 'Channel name contains invalid characters';
  a.socket.emit('error-msg', error);
  assert.equal(a.create.querySelector('[role="alert"]').textContent, error);
  assert.ok(!a.dialog.hidden && !submit.disabled);
  assert.equal(a.doc.activeElement, a.name);
  assert.equal(a.name.value, 'studio');
  assert.equal(a.byId('new-channel-template').value, 'b:voice_room');
  a.create.fire('submit');
  a.socket.emit('channel-created', { name: 'studio', created_by: 17 });
  assert.ok(a.dialog.hidden);
  assert.equal(a.doc.activeElement, a.add);
  assert.equal(window.app._habitatAddError, undefined);
  a.plugin.stop();
});

test('join handles code refusal, rotation and the two server invite receipts', () => {
  const a = channelDialog({ canCreate: false });
  const submitted = [];
  a.socket.on('join-channel', ({ code }) => submitted.push(code));
  a.socket.emit('error-msg', 'Message not found');
  a.code.value = 'deadbeef';
  a.join.fire('submit');
  assert.equal(a.join.querySelector('[type="submit"]').textContent, 'Joining…');
  a.socket.emit('user-joined', { user: { id: 23 }, channelCode: 'another' });
  assert.ok(!a.dialog.hidden);
  a.socket.emit('error-msg', 'Invalid channel code. Double-check it');
  assert.equal(a.join.querySelector('[role="alert"]').textContent, 'Invalid channel code. Double-check it');
  assert.deepEqual(a.toasts, [{ msg: 'Message not found', type: 'error' }]);
  assert.equal(a.doc.activeElement, a.code);
  assert.equal(a.code.value, 'deadbeef');
  a.join.fire('submit');
  // A role-gated joiner receives only the private receipt with the rotated code.
  a.socket.emit('channel-joined', { code: 'feedcafe' });
  assert.ok(a.dialog.hidden);
  for (const [event, receipt] of [['toast', { message: 'Invite accepted: joined 2 channels', type: 'success' }],
    ['error-msg', 'Server code accepted: joined 1 channel']]) {
    a.add.click();
    a.code.value = 'cafefeed';
    a.join.fire('submit');
    a.socket.emit(event, receipt);
    assert.ok(a.dialog.hidden);
  }
  assert.deepEqual(submitted, ['deadbeef', 'deadbeef', 'cafefeed', 'cafefeed']);
  a.plugin.stop();
});

test('disengaging mid-request returns the original draft, controls and native Enter handler', () => {
  const a = channelDialog({ prepare(byId, haven) {
    byId('new-channel-template').value = 'b:announcements';
    haven._applyChannelTemplate('b:announcements');
    byId('new-channel-name').value = 'sidebar draft';
    byId('new-channel-topic').value = 'sidebar topic';
  } });
  assert.equal(a.name.value, '');
  const submitted = [];
  a.socket.on('create-channel', data => submitted.push(data));
  a.name.value = 'dialog draft';
  a.name.fire('keydown', { key: 'Enter' });
  a.create.fire('submit'); // The browser's implicit submit follows the keydown.
  assert.equal(submitted.length, 1);
  a.plugin._disengage();
  assert.equal(snapshot(a.doc.documentElement), a.before);
  assert.equal(a.byId('new-channel-name'), a.name);
  assert.equal(a.name.value, 'sidebar draft');
  assert.equal(a.byId('new-channel-topic').value, 'sidebar topic');
  assert.equal(a.byId('new-channel-template').value, 'b:announcements');
  assert.equal(window.app._habitatAddError, undefined);
  a.socket.emit('error-msg', 'Failed to create channel');
  assert.deepEqual(a.toasts.at(-1), { msg: 'Failed to create channel', type: 'error' });
  a.name.fire('keydown', { key: 'Enter' });
  assert.equal(submitted.length, 2);
  assert.equal(submitted[1].announcement, true);
  assert.equal(a.name.value, '');
  a.plugin.stop();
});

test('a dismissed submission cannot close a fresh opening and a lost connection allows retry', () => {
  const a = channelDialog();
  a.name.value = 'studio';
  a.create.fire('submit');
  const cancel = a.create.querySelector('footer [type="button"]');
  cancel.click();
  assert.equal(a.doc.activeElement, a.add);
  a.add.click();
  assert.equal(a.name.value, '');
  a.socket.emit('channel-created', { name: 'studio', created_by: 17 });
  assert.ok(!a.dialog.hidden);
  a.name.value = 'next';
  a.create.fire('submit');
  a.socket.emit('disconnect');
  assert.ok(!a.dialog.hidden && !a.create.querySelector('[type="submit"]').disabled);
  assert.equal(a.doc.activeElement, a.name);
  assert.equal(a.name.value, 'next');
  a.plugin.stop();
});

test('the sidebar temporary shortcut opens its expiry options in the Create tab', () => {
  const a = channelDialog();
  a.doc.fire('keydown', { key: 'Escape' });
  const shortcut = el(a.doc, 'div', { class: 'temp-channel-create-btn' });
  a.channels.appendChild(shortcut);
  const click = a.channels.fire('click', { target: shortcut });
  assert.ok(click.stopped);
  assert.ok(!a.dialog.hidden && !a.create.hidden);
  assert.ok(!a.byId('habitat-channel-options').hidden && a.byId('new-channel-temporary').checked);
  assert.equal(a.byId('temp-channel-duration-row').style.display, '');
  assert.equal(a.doc.activeElement, a.name);
  a.plugin.stop();
});

test('in a call, mute and deafen show beside the account, and go again afterwards', () => {
  const app = buildApp();
  const root = app.doc.documentElement;
  const plugin = new HabitatLayout();
  plugin.start();
  assert.equal(root.hasAttribute('data-habitat-in-voice'), false, 'no call yet');

  app.call(true);
  assert.ok(root.hasAttribute('data-habitat-in-voice'));
  const tools = app.account.querySelector('[data-habitat-tools]');
  assert.ok(tools.contains(app.doc.getElementById('voice-mute-btn')), 'the real mute button is in the account bar');
  assert.ok(tools.contains(app.doc.getElementById('voice-deafen-btn')));
  // The buttons are shown by this state alone, never by rewriting the inline
  // style Haven keeps resetting on them.
  assert.match(HabitatLayout.CSS,
    /\[data-habitat-in-voice\] \[data-habitat-tools\] > :is\(#voice-mute-btn, #voice-deafen-btn\)\s*\{[^}]*display:\s*inline-flex !important/);

  app.call(false);
  assert.equal(root.hasAttribute('data-habitat-in-voice'), false, 'hanging up takes them away');
  plugin.stop();
});

test('a call that is already on when the layout starts is picked up straight away', () => {
  const app = buildApp();
  app.call(true);
  const plugin = new HabitatLayout();
  plugin.start();
  assert.ok(app.doc.documentElement.hasAttribute('data-habitat-in-voice'));
  plugin.stop();
});

test('switching the layout off mid-call leaves no call state or watcher behind', () => {
  const app = buildApp();
  const plugin = new HabitatLayout();
  plugin.start();
  app.call(true);
  plugin._disengage();
  assert.equal(app.doc.documentElement.hasAttribute('data-habitat-in-voice'), false);
  assert.equal(FakeMutationObserver.live.size, 0, 'the voice bar is no longer watched');
  app.call(false);
  app.call(true);
  assert.equal(app.doc.documentElement.hasAttribute('data-habitat-in-voice'), false, 'a later call no longer reaches the layout');
  plugin.stop();
});

test('the members panel keeps its own mute buttons on a phone, and drops the second copy on a desktop', () => {
  const duplicate = HabitatLayout.CSS.match(/[^{}]*\.voice-header-actions\s*\{[^}]*\}/)?.[0] || '';
  assert.match(duplicate, /html\[data-habitat-layout-desktop="1"\]\[data-habitat-in-voice\]/,
    'only the desktop shape, and only during a call');
  assert.match(duplicate, /display:\s*none/);
});

test('the members sidebar gives the roster no space, in or out of the stage', () => {
  const { doc, context, media } = buildApp();
  const roster = doc.querySelector('[data-haven-region="voice-roster"]');
  const close = el(doc, 'button', { id: 'mobile-right-close' });
  roster.appendChild(close);
  doc.body.appendChild(region(doc, 'message-area'));
  doc.body.appendChild(el(doc, 'div', { id: 'voice-active-indicator' }));
  const invite = el(doc, 'button', { id: 'right-btn-invite-popout' });
  const invitePanel = el(doc, 'div', { id: 'sidebar-invite-panel' }, [invite]);
  context.appendChild(invitePanel);
  const before = snapshot(doc.documentElement);
  const layout = new HabitatLayout();
  layout.start();
  assert.equal(roster.parentNode, context);
  assert.ok(doc.querySelector('[data-habitat-menu]').contains(invite));
  const css = HabitatLayout.CSS;
  assert.match(css, /html\[data-habitat-layout\] \[data-haven-region="context-sidebar"\] > \[data-haven-region="voice-roster"\],[^{}]*\[data-habitat-roster-home\][^{}]*\{ display: none;/);
  assert.match(css, /html\[data-habitat-layout="compact"\] \[data-habitat-roster-home\]:not\(:empty\) \{ display: block;/);
  doc.querySelector('[data-habitat-call-view]').fire('click');
  assert.equal(roster.parentNode, doc.querySelector('[data-habitat-call-stage]'));
  assert.equal(close.parentNode, roster);
  assert.deepEqual(context.querySelector('[data-habitat-roster-home]').children, []);
  media.set(false);
  assert.ok(doc.querySelector('[data-habitat-menu="server"]').contains(invite));
  doc.querySelector('[data-habitat-call-view]').fire('click');
  assert.equal(close.parentNode, context.querySelector('[data-habitat-roster-home]'));
  layout.stop();
  assert.equal(snapshot(doc.documentElement), before);
});

test('the call view returns the live roster and the drawer close button on leave or layout change', () => {
  const { doc, context } = buildApp({ desktop: false, phone: true });
  const area = region(doc, 'message-area');
  const indicator = el(doc, 'div', { id: 'voice-active-indicator' });
  const close = el(doc, 'button', { id: 'mobile-right-close' });
  const roster = doc.querySelector('[data-haven-region="voice-roster"]');
  roster.appendChild(close);
  doc.body.appendChild(area);
  doc.body.appendChild(indicator);
  indicator.style.display = 'none';
  const before = snapshot(doc.body);
  const layout = new HabitatLayout();
  layout.start();
  const toggle = doc.querySelector('[data-habitat-call-view]');
  assert.ok(toggle.hidden);
  indicator.style.display = 'flex';
  FakeMutationObserver.notify(indicator);
  toggle.fire('click');
  const stage = doc.querySelector('[data-habitat-call-stage]');
  assert.equal(stage.parentNode, area);
  assert.equal(roster.parentNode, stage);
  assert.ok(context.contains(close));
  indicator.style.display = 'none';
  FakeMutationObserver.notify(indicator);
  assert.equal(roster.parentNode, context);
  assert.equal(close.parentNode, doc.querySelector('[data-habitat-roster-home]'),
    'on a phone the drawer\'s close button waits in the placeholder for as long as the layout is on');
  assert.equal(doc.querySelector('[data-habitat-call-stage]'), null, 'the empty stage leaves the page');
  indicator.style.display = 'flex';
  FakeMutationObserver.notify(indicator);
  toggle.fire('click');
  layout.stop();
  assert.equal(snapshot(doc.body), before);
});

test('on a phone the way into a text channel\'s call moves from the hidden roster block to the channel menu', () => {
  const { doc } = buildApp({ desktop: false, phone: true });
  const roster = doc.querySelector('[data-haven-region="voice-roster"]');
  const join = el(doc, 'button', { id: 'voice-join-mobile' });
  join.style.display = 'none';
  roster.appendChild(join);
  doc.body.appendChild(el(doc, 'div', { id: 'header-actions-box' }, [el(doc, 'button', { id: 'copy-code-btn' })]));
  const before = snapshot(doc.body);
  const layout = new HabitatLayout();
  layout.start();
  const menu = doc.querySelector('[data-habitat-channel-menu]');
  assert.equal(join.parentNode, menu);
  assert.ok(menu.children.indexOf(join) < menu.children.indexOf(menu.querySelector('[data-habitat-channel-management]')));
  assert.equal(join.style.display, 'none', 'Haven still decides when it shows');
  layout.stop();
  assert.equal(join.parentNode, roster);
  assert.equal(snapshot(doc.body), before);
});

// A call with a roster, Haven's camera and stream panels, and a stage of a known size.
function buildCall({ people = 2, width = 1000, height = 600, desktop = true, open = true } = {}) {
  const app = buildApp({ desktop, phone: !desktop });
  const { doc } = app;
  const tile = (id, name) => el(doc, 'div', { id, class: name }, [el(doc, 'video')]);
  const cameras = el(doc, 'div', { id: 'webcam-grid' });
  const shares = el(doc, 'div', { id: 'screen-share-grid' });
  const webcams = region(doc, 'webcams', [cameras]);
  const streams = region(doc, 'screen-shares', [shares]);
  const messages = region(doc, 'message-list');
  const area = region(doc, 'message-area', [webcams, streams, messages]);
  const indicator = el(doc, 'div', { id: 'voice-active-indicator' });
  const users = el(doc, 'div', { id: 'voice-users' });
  const person = (id) => el(doc, 'div', { class: 'user-item voice-user-item', 'data-user-id': String(id) },
    [el(doc, 'span', { class: 'user-item-name' })]);
  for (let id = 1; id <= people; id++) users.appendChild(person(id));
  const roster = doc.querySelector('[data-haven-region="voice-roster"]');
  roster.appendChild(users);
  doc.body.appendChild(area);
  doc.body.appendChild(indicator);
  globalThis.getComputedStyle = () => ({ columnGap: '10px', paddingLeft: '0px', paddingRight: '0px', paddingTop: '0px', paddingBottom: '0px', fontSize: '16px' });
  const before = snapshot(doc.body);
  const layout = new HabitatLayout();
  layout.start();
  if (!open) return { ...app, layout, area, indicator, users, cameras, shares, webcams, streams, tile, before };
  doc.querySelector('[data-habitat-call-view]').fire('click');
  const stage = doc.querySelector('[data-habitat-call-stage]');
  stage.clientWidth = width;
  stage.clientHeight = height;
  const settle = () => FakeMutationObserver.notify(stage);
  settle();
  const cell = (node) => node.style.getPropertyValue('grid-area');
  return { ...app, layout, area, stage, users, cameras, shares, webcams, streams, person, tile, settle, cell, before };
}

test('the stage grid picks the largest tiles that fit everyone on one screen', () => {
  const grid = (count, width, height) => HabitatLayout.stageGrid(count, width, height, 10);
  assert.deepEqual([grid(1, 1000, 600).cols, grid(1, 1000, 600).rows], [1, 1]);
  assert.deepEqual([grid(2, 1200, 500).cols, grid(2, 1200, 500).rows], [2, 1], 'two people on a wide screen sit side by side');
  assert.deepEqual([grid(2, 360, 700).cols, grid(2, 360, 700).rows], [1, 2], 'and one above the other on a phone');
  for (const [count, width, height] of [[1, 360, 640], [5, 360, 640], [9, 1000, 600], [16, 1000, 600], [25, 360, 640]]) {
    const fit = grid(count, width, height);
    assert.ok(fit.cols * fit.rows >= count, `${count} tiles have a cell each`);
    assert.ok(fit.cols * fit.width + (fit.cols - 1) * 10 <= width + 0.01, `${count} tiles fit the width`);
    assert.ok(fit.rows * fit.height + (fit.rows - 1) * 10 <= height + 0.01, `${count} tiles fit the height`);
    const ratio = fit.width / fit.height;
    assert.ok(ratio >= 4 / 3 - 0.01 && ratio <= 16 / 9 + 0.01, `${count} tiles keep a picture shape`);
  }
  assert.equal(HabitatLayout.stageGrid(6, 1000, 120, 10, 1).rows, 1, 'the strip under a shared screen stays one row');
});

test('a click made alone does not send that tile to the large spot when someone joins', () => {
  const { stage, users, person, settle, layout } = buildCall({ people: 1 });
  const [me] = users.querySelectorAll('.voice-user-item');
  stage.fire('click', { target: me });
  assert.ok(!stage.hasAttribute('data-habitat-focus'));
  users.appendChild(person(2));
  settle();
  assert.ok(!stage.hasAttribute('data-habitat-focus'), 'two people share the grid');
  assert.ok(!me.hasAttribute('data-habitat-focused'));
  layout.stop();
});

test('the call stage gives every person one cell and centres a short last row', () => {
  const { stage, users, cell, layout } = buildCall({ people: 5, width: 1200 });
  assert.equal(stage.style.getPropertyValue('--hb-stage-cols'), '6', 'three people a row, two half columns each');
  const rows = users.querySelectorAll('.voice-user-item');
  assert.deepEqual(rows.map(cell), [
    '1 / 1 / span 1 / span 2', '1 / 3 / span 1 / span 2', '1 / 5 / span 1 / span 2',
    '2 / 2 / span 1 / span 2', '2 / 4 / span 1 / span 2'
  ]);
  assert.ok(!stage.hasAttribute('data-habitat-focus'));
  layout.stop();
});

test('a camera fills its owner\'s tile, and a screen share takes the large spot until it is put back', () => {
  const { doc, stage, area, users, cameras, shares, webcams, streams, tile, settle, cell, layout, before } = buildCall({ people: 3 });
  assert.equal(webcams.parentNode, stage, 'Haven\'s panels dissolve into the stage');
  assert.equal(streams.parentNode, stage);
  const [first, second] = users.querySelectorAll('.voice-user-item');
  const camera = tile('webcam-tile-2', 'webcam-tile');
  cameras.appendChild(camera);
  settle();
  assert.equal(cell(camera), cell(second), 'the picture and the person share a cell');
  assert.ok(second.hasAttribute('data-habitat-on-camera'));
  assert.ok(camera.hasAttribute('data-habitat-paired'));
  assert.ok(!first.hasAttribute('data-habitat-on-camera'));

  const share = tile('screen-tile-1', 'screen-share-tile');
  shares.appendChild(share);
  settle();
  assert.ok(stage.hasAttribute('data-habitat-focus'));
  assert.ok(share.hasAttribute('data-habitat-focused'));
  assert.equal(cell(share), '', 'the large tile is not in the strip');
  assert.equal(stage.style.getPropertyValue('--hb-stage-cols'), '6', 'three people in one row beneath');
  assert.equal(cell(camera), '1 / 3 / span 1 / span 2');

  // A share the viewer closed is hidden by Haven, not removed.
  share.setAttribute('data-hidden', 'true');
  settle();
  assert.ok(!stage.hasAttribute('data-habitat-focus'));
  share.removeAttribute('data-hidden');
  settle();
  assert.ok(share.hasAttribute('data-habitat-focused'));

  // A click on the large tile returns to the grid, and it stays there.
  stage.fire('click', { target: share });
  assert.ok(!stage.hasAttribute('data-habitat-focus'));
  assert.equal(cell(share), '1 / 1 / span 1 / span 2');
  settle();
  assert.ok(!stage.hasAttribute('data-habitat-focus'), 'the member\'s choice outlasts a redraw');
  // A click on a person enlarges them; a click on a button inside a tile does not.
  stage.fire('click', { target: first });
  assert.ok(first.hasAttribute('data-habitat-focused'));
  const menu = el(doc, 'button');
  second.appendChild(menu);
  stage.fire('click', { target: menu });
  assert.ok(first.hasAttribute('data-habitat-focused'));
  assert.ok(stage.fire('dblclick', { target: camera }).stopped, 'Haven\'s own enlarge stays out of the stage');
  assert.ok(stage.captured.has('dblclick'));

  // A screen popped out into its own window keeps a place in the row only.
  stage.fire('click', { target: share });
  assert.ok(share.hasAttribute('data-habitat-focused'));
  share.setAttribute('class', 'screen-share-tile stream-popped-out');
  settle();
  assert.ok(!share.hasAttribute('data-habitat-focused'), 'a placeholder never takes the large spot');
  assert.notEqual(cell(share), '');
  share.setAttribute('class', 'screen-share-tile');
  stage.fire('click', { target: first });
  settle();

  // A second shared screen waits in the row until it is asked for.
  const spread = stage.querySelector('[data-habitat-stage-spread]');
  assert.ok(spread.hidden, 'one screen needs no choice');
  stage.fire('click', { target: share });
  assert.ok(share.hasAttribute('data-habitat-focused'));
  const otherScreen = tile('screen-tile-3', 'screen-share-tile');
  shares.appendChild(otherScreen);
  settle();
  assert.ok(!spread.hidden);
  assert.ok(share.hasAttribute('data-habitat-focused'));
  assert.ok(!otherScreen.hasAttribute('data-habitat-focused'), 'the first screen keeps the large spot');
  assert.notEqual(cell(otherScreen), '', 'the newcomer joins the row');
  spread.fire('click');
  assert.equal(spread.getAttribute('aria-pressed'), 'true');
  assert.ok(share.hasAttribute('data-habitat-focused') && otherScreen.hasAttribute('data-habitat-focused'), 'both, on request');
  assert.notEqual(share.style.getPropertyValue('left') + share.style.getPropertyValue('top'),
    otherScreen.style.getPropertyValue('left') + otherScreen.style.getPropertyValue('top'), 'each in its own part of the large spot');
  stage.fire('click', { target: otherScreen });
  assert.ok(otherScreen.hasAttribute('data-habitat-focused') && !share.hasAttribute('data-habitat-focused'), 'a click keeps the one clicked');
  assert.equal(share.style.getPropertyValue('width'), '', 'a tile back in the row gives up its large size');
  assert.equal(spread.getAttribute('aria-pressed'), 'false');
  otherScreen.remove();
  settle();
  assert.ok(spread.hidden);

  // Leaving: Haven's tiles go, then the layout hands everything back.
  menu.remove();
  camera.remove();
  share.remove();
  layout.stop();
  assert.equal(webcams.parentNode, area);
  assert.equal(streams.parentNode, area);
  assert.equal(snapshot(doc.body), before);
  for (const row of users.querySelectorAll('.voice-user-item')) assert.equal(cell(row), '');
});

test('a camera or a shared screen opens the stage by itself, once per call', () => {
  const { doc, area, indicator, shares, streams, tile, layout, before } = buildCall({ open: false });
  const toggle = doc.querySelector('[data-habitat-call-view]');
  const open = () => doc.querySelector('[data-habitat-call-stage]')?.parentNode === area;
  assert.ok(!open(), 'a call with voices only stays in the roster');
  const share = tile('screen-tile-2', 'screen-share-tile');
  shares.appendChild(share);
  FakeMutationObserver.notify(streams);
  assert.ok(open(), 'Haven\'s stacked panels are never the first thing shown');
  assert.equal(toggle.getAttribute('aria-pressed'), 'true');
  // Closed by hand, it stays closed for the rest of the call.
  toggle.fire('click');
  shares.appendChild(tile('screen-tile-3', 'screen-share-tile'));
  FakeMutationObserver.notify(streams);
  assert.ok(!open());
  // The next call starts fresh.
  indicator.style.display = 'none';
  FakeMutationObserver.notify(indicator);
  indicator.style.display = 'flex';
  FakeMutationObserver.notify(indicator);
  assert.ok(open(), 'screens already shared when the call is joined open it too');
  for (const node of [...shares.children]) node.remove();
  layout.stop();
  assert.equal(snapshot(doc.body), before);
  assert.equal(FakeMutationObserver.live.size, 0);
});

test('only a newcomer settles into the stage; a redraw of the others replays nothing', () => {
  const { stage, users, person, settle, layout } = buildCall({ people: 2 });
  const entering = () => users.querySelectorAll('.voice-user-item').filter(row => row.hasAttribute('data-habitat-enter'))
    .map(row => row.getAttribute('data-user-id'));
  assert.deepEqual(entering(), [], 'the people already there when the stage opens just appear');
  users.appendChild(person(3));
  settle();
  assert.deepEqual(entering(), ['3']);
  // Haven throws every row away and draws them again when anyone's state changes.
  for (const row of [...users.children]) row.remove();
  for (const id of [1, 2, 3]) users.appendChild(person(id));
  settle();
  assert.deepEqual(entering(), [], 'known faces do not enter twice');
  assert.equal(stage.querySelectorAll('[data-habitat-leave]').length, 0);
  layout.stop();
});

test('tiles glide to their new place when the grid regroups, and not when the window is resized', () => {
  const { stage, users, settle, layout } = buildCall({ people: 2 });
  const [first, second] = users.querySelectorAll('.voice-user-item');
  const glides = [];
  const seat = (row, left, top, width, height) => Object.assign(row, { offsetLeft: left, offsetTop: top, offsetWidth: width, offsetHeight: height });
  for (const row of [first, second]) row.animate = (frames, timing) => { glides.push({ row, frames, timing }); return { cancel() {} }; };
  seat(first, 0, 0, 400, 300);
  seat(second, 410, 0, 400, 300);
  settle();
  assert.equal(glides.length, 0, 'where things sit is learnt first');
  // Someone took the large spot: the second person moves under the first.
  seat(second, 0, 310, 400, 300);
  settle();
  assert.equal(glides.length, 1);
  assert.equal(glides[0].row, second);
  assert.equal(glides[0].frames[0].translate, '410px -310px', 'from where it was');
  assert.equal(glides[0].frames[1].translate, '0 0', 'to where it belongs');
  assert.ok(glides[0].timing.duration <= 250);
  settle();
  assert.equal(glides.length, 1, 'a second look at the same grid starts nothing');
  // A window being dragged narrower moves everything on every pixel.
  stage.clientWidth = 700;
  seat(first, 0, 0, 340, 255);
  seat(second, 0, 265, 340, 255);
  settle();
  assert.equal(glides.length, 1);
  layout.stop();
});

test('alone in a voice room the stage says so, and stops saying it when someone joins', () => {
  const { doc, stage, users, person, settle, layout } = buildCall({ people: 1 });
  const note = stage.querySelector('[data-habitat-alone]');
  assert.ok(note.hidden, 'a call in a text channel has the chat to look at');
  stage.setAttribute('data-habitat-voice-room', '');
  settle();
  assert.ok(!note.hidden);
  assert.ok(note.querySelector('button').hidden, 'no invite button without Haven\'s own');
  const real = el(doc, 'button', { id: 'right-btn-invite-popout' });
  let asked = 0;
  real.click = () => { asked++; };
  doc.body.appendChild(real);
  settle();
  assert.ok(!note.querySelector('button').hidden);
  note.querySelector('button').fire('click');
  assert.equal(asked, 1, 'the button presses Haven\'s invite');
  users.appendChild(person(2));
  settle();
  assert.ok(note.hidden);
  real.remove();
  layout.stop();
});

test('a profile picture of any shape fills the stage face instead of hanging out of it', () => {
  // A grid item's percentage height has nothing definite to measure against,
  // so a tall photo kept its own height and showed as an oval over the name.
  const rule = HabitatLayout.CSS.match(/\[data-habitat-call-avatar\] > \[data-habitat-call-photo\]\s*\{[^}]*\}/)?.[0] || '';
  assert.match(rule, /position:\s*absolute/);
  assert.match(rule, /inset:\s*0/);
  assert.match(rule, /object-fit:\s*cover/);
  assert.match(HabitatLayout.CSS, /\[data-habitat-call-avatar\]\s*\{[^}]*position:\s*relative/, 'the face is what the picture is pinned to');
});

test('the stage carries stand-ins for the call buttons on a desktop, and they press the real ones', () => {
  const { doc, stage, layout } = buildCall();
  const group = stage.querySelector('[data-habitat-stage-controls]');
  const names = group.querySelectorAll('[data-habitat-for]').map(button => button.getAttribute('data-habitat-for'));
  assert.deepEqual(names, ['voice-mute-btn', 'voice-deafen-btn', 'voice-cam-btn', 'screen-share-btn', 'voice-bar-leave-btn']);
  const mute = doc.getElementById('voice-mute-btn');
  let pressed = 0;
  mute.click = () => { pressed++; mute.setAttribute('class', 'muted'); };
  const stand = group.children[0];
  assert.equal(stand.getAttribute('title'), 'Mute', 'named after the button it stands for');
  assert.equal(stand.getAttribute('aria-pressed'), 'false');
  stand.fire('click');
  assert.equal(pressed, 1);
  FakeMutationObserver.notify(doc.getElementById('voice-bar'));
  assert.equal(stand.getAttribute('aria-pressed'), 'true', 'and shows its state');
  assert.ok(group.children[2].hidden, 'a button the page does not have gets no stand-in');
  assert.ok(!stage.fire('click', { target: stand }).stopped);
  assert.ok(!stage.hasAttribute('data-habitat-focus'), 'pressing one does not enlarge a tile');
  layout.stop();
  assert.equal(doc.querySelector('[data-habitat-stage-controls]'), null);
});

test('the stage mirrors native and ARIA availability, including a replacement source', () => {
  const { doc, stage, layout } = buildCall();
  const proxy = stage.querySelector('[data-habitat-for="voice-mute-btn"]');
  const source = doc.getElementById('voice-mute-btn');
  const tools = source.parentNode;
  let clicks = 0;
  source.click = () => clicks++;
  source.disabled = true;
  FakeMutationObserver.notify(tools);
  proxy.fire('click');
  assert.equal(proxy.disabled, true);
  source.disabled = false;
  source.setAttribute('aria-disabled', 'true');
  FakeMutationObserver.notify(tools);
  proxy.fire('click');
  assert.equal(clicks, 0);
  assert.equal(proxy.getAttribute('aria-disabled'), 'true');
  source.removeAttribute('aria-disabled');
  source.hidden = true;
  FakeMutationObserver.notify(tools);
  assert.equal(proxy.hidden, true);
  assert.equal(proxy.getAttribute('aria-disabled'), null);
  source.hidden = false;
  source.style.display = 'none';
  FakeMutationObserver.notify(tools);
  assert.equal(proxy.hidden, true);
  source.remove();
  tools.appendChild(el(doc, 'button', { id: source.id, title: 'Replacement' }));
  FakeMutationObserver.notify(tools);
  assert.equal(proxy.hidden, false);
  assert.ok(!proxy.disabled);
  assert.equal(proxy.getAttribute('aria-label'), 'Replacement');
  layout.stop();
});

for (const desktop of [true, false]) {
  test('the call menu forwards native actions and restores focus and regions on ' + (desktop ? 'desktop' : 'phone'), () => {
    const { doc, stage, area, voiceControls, layout, cameras, shares, tile, settle } = buildCall({ desktop });
    const more = doc.querySelector('[data-habitat-call-more]');
    const menu = doc.getElementById('habitat-menu-call');
    assert.equal(more.parentNode, desktop ? stage.querySelector('[data-habitat-stage-controls]') : voiceControls);
    const leave = more.parentNode.children.at(-1);
    assert.equal(leave.getAttribute('data-habitat-for') || leave.id, desktop ? 'voice-bar-leave-btn' : 'voice-leave-sidebar-btn');
    assert.equal(more.nextSibling, leave);
    const settings = doc.querySelector('[data-haven-region="voice-settings"]');
    assert.equal(settings.parentNode, area);
    const hits = [];
    const action = (parent, attrs) => {
      const b = el(doc, 'button', attrs);
      parent.appendChild(b);
      b.addEventListener('click', () => hits.push(b));
      return b;
    };
    const gear = action(voiceControls, { id: 'voice-settings-toggle' });
    gear.style.display = 'none';
    settings.style.display = 'none';
    gear.addEventListener('click', () => { settings.style.display = settings.style.display === 'none' ? '' : 'none'; });
    const sound = action(voiceControls, { id: 'voice-soundboard-btn' });
    const listen = action(voiceControls, { id: 'voice-listen-together-btn' });
    const camera = tile('webcam-tile-1', 'webcam-tile');
    cameras.appendChild(camera);
    const label = el(doc, 'span', { class: 'webcam-tile-label' });
    label.textContent = 'Deniz';
    camera.appendChild(label);
    const pop = action(camera, { class: 'stream-popout-btn' });
    for (const id of ['a', 'b']) shares.appendChild(tile(id, 'screen-share-tile'));
    settle();
    const pick = (name, focus = more) => {
      more.click();
      const row = menu.querySelector(`[aria-label="${name}"]`);
      assert.ok(row, name);
      row.focus();
      row.click();
      menu.fire('click', { target: row }); // bubble in the DOM double
      assert.ok(menu.hidden);
      assert.equal(doc.activeElement, focus);
    };
    more.click();
    assert.equal(doc.activeElement.getAttribute('aria-label'), 'Voice settings');
    menu.fire('keydown', { key: 'ArrowDown' });
    assert.equal(doc.activeElement.getAttribute('aria-label'), 'Connection details');
    menu.fire('keydown', { key: 'ArrowUp' });
    assert.equal(doc.activeElement.getAttribute('aria-label'), 'Voice settings');
    doc.fire('keydown', { key: 'Escape' });
    assert.ok(menu.hidden);
    assert.equal(doc.activeElement, more);
    more.click();
    doc.fire('pointerdown', { target: area });
    assert.ok(menu.hidden);
    assert.equal(doc.activeElement, more);
    const heading = settings.querySelector('[data-habitat-call-settings-heading]');
    const close = heading.querySelector('button');
    pick('Voice settings', close);
    assert.equal(settings.style.display, '');
    close.click();
    assert.equal(settings.style.display, 'none');
    assert.equal(doc.activeElement, more);
    pick('Soundboard');
    pick('Listen together');
    pick('Pop out camera for Deniz');
    camera.setAttribute('class', 'webcam-tile webcam-popped-out');
    doc.pictureInPictureElement = camera.querySelector('video');
    pick('Return camera for Deniz');
    doc.pictureInPictureElement = null;
    const overlay = el(doc, 'div', { id: 'webcam-pip-1' });
    doc.body.appendChild(overlay);
    const popIn = action(overlay, { class: 'stream-pip-popin' });
    pick('Return camera for Deniz');
    assert.deepEqual(hits, [gear, gear, sound, listen, pop, pop, popIn]);
    pick('Connection details');
    assert.equal(doc.querySelector('[data-habitat-connection]').hidden, false);
    pick('Show every shared screen together');
    assert.equal(stage.querySelector('[data-habitat-stage-spread]').getAttribute('aria-pressed'), 'true');
    pick('Return to grid');
    assert.ok(!stage.hasAttribute('data-habitat-focus'));
    more.click();
    doc.querySelector('[data-habitat-call-view]').click();
    assert.ok(menu.hidden);
    assert.ok(!area.contains(settings));
    assert.ok(!doc.body.contains(more));
    layout._disengage();
    assert.equal(doc.getElementById('habitat-menu-call'), null);
    assert.ok(voiceControls.contains(gear));
    assert.ok(!more.listenerCount());
    layout.stop();
  });
}

test('one tab stop per enlargable tile preserves native controls and restores original attributes', () => {
  const { doc, layout, stage, users, cameras, shares, tile, settle } = buildCall();
  users.children[0].querySelector('.user-item-name').textContent = 'Deniz';
  const camera = tile('webcam-tile-1', 'webcam-tile');
  camera.setAttribute('role', 'group');
  camera.setAttribute('tabindex', '-1');
  camera.setAttribute('aria-label', 'Original camera');
  camera.style.setProperty('width', '11rem');
  const native = el(doc, 'button');
  camera.appendChild(native);
  cameras.appendChild(camera);
  const screen = tile('screen-tile-2', 'screen-share-tile');
  shares.appendChild(screen);
  settle();
  assert.equal(camera.getAttribute('aria-label'), 'Enlarge camera for Deniz');
  assert.equal(users.children[0].getAttribute('tabindex'), null, 'the overlay has no duplicate tab stop');
  for (const target of [camera, users.children[1], screen]) assert.equal(target.getAttribute('tabindex'), '0');
  camera.focus();
  for (const [key, state] of [['Enter', 'true'], [' ', 'false'], [' ', 'true'], ['Escape', 'false']]) {
    assert.ok(stage.fire('keydown', { target: camera, key }).defaultPrevented);
    assert.equal(camera.getAttribute('aria-pressed'), state);
    assert.equal(camera.hasAttribute('data-habitat-focused'), state === 'true');
    assert.equal(doc.activeElement, camera);
  }
  assert.ok(!stage.fire('keydown', { target: native, key: ' ' }).defaultPrevented);
  layout._disengage();
  assert.equal(camera.getAttribute('role'), 'group');
  assert.equal(camera.getAttribute('tabindex'), '-1');
  assert.equal(camera.getAttribute('aria-label'), 'Original camera');
  assert.equal(camera.style.getPropertyValue('width'), '11rem');
  assert.equal(camera.getAttribute('aria-pressed'), null);
  assert.equal(screen.getAttribute('role'), null);
  assert.equal(screen.getAttribute('tabindex'), null);
  assert.equal(stage.listenerCount(), 0);
  layout.stop();
});

test('a phone gets no stand-ins: the real row is under the stage', () => {
  const { stage, layout } = buildCall({ desktop: false });
  assert.equal(stage.querySelector('[data-habitat-stage-controls]'), null);
  layout.stop();
});

test('on a phone the call buttons sit under the stage, and go back to the drawer with it', () => {
  const { doc, area, stage, context, voiceControls, layout, before } = buildCall({ desktop: false });
  const settings = doc.querySelector('[data-haven-region="voice-settings"]');
  assert.equal(voiceControls.parentNode, area);
  assert.equal(stage.nextSibling, settings, 'the settings panel opens right above the buttons');
  assert.equal(settings.nextSibling, voiceControls);
  assert.ok(voiceControls.hasAttribute('data-habitat-call-bar'));
  assert.equal(voiceControls.style.getPropertyValue('position'), 'static');
  assert.equal(voiceControls.style.getPropertyPriority('position'), 'important', 'Haven positions the bar inline');
  doc.querySelector('[data-habitat-call-view]').fire('click');
  assert.equal(voiceControls.parentNode, context);
  assert.equal(settings.parentNode, context);
  assert.equal(voiceControls.style.getPropertyValue('position'), 'absolute');
  assert.equal(voiceControls.style.getPropertyValue('top'), '');
  layout.stop();
  assert.equal(snapshot(doc.body), before);
});

test('a voice room already joined when the phone layout is built gets its call buttons too', () => {
  const { doc, voiceControls } = buildApp({ desktop: false, phone: true });
  const area = region(doc, 'message-area');
  doc.body.appendChild(area);
  doc.body.appendChild(el(doc, 'div', { id: 'voice-active-indicator' }));
  Object.assign(window.app, {
    currentChannel: 'lobi', voice: { inVoice: true, currentChannel: 'lobi' }, _isVoiceOnlyChannel: () => true
  });
  const layout = new HabitatLayout();
  layout.start();
  assert.equal(doc.querySelector('[data-habitat-call-stage]')?.parentNode, area, 'the room opens its stage as the layout comes up');
  assert.equal(voiceControls.parentNode, area, 'with the buttons under it, not left in the drawer');
  layout.stop();
});

test('on a desktop the call buttons stay docked in the sidebar footer', () => {
  const { area, footer, voiceControls, layout } = buildCall();
  assert.equal(voiceControls.parentNode, footer);
  assert.ok(!voiceControls.hasAttribute('data-habitat-call-bar'));
  assert.ok(!area.contains(voiceControls));
  layout.stop();
});

test('a click on someone under a voice room opens their profile, and the card carries their volume', () => {
  const { doc } = buildApp();
  window.t = key => key;
  const asked = [];
  const volumes = new Map();
  const applied = [];
  Object.assign(window.app, {
    user: { id: 1 },
    socket: { emit: (name, data) => asked.push([name, data]) },
    voiceChannelUsers: { lobi: [{ id: 1 }, { id: 2 }] },
    voice: { setVolume: (id, value) => applied.push([id, value]) },
    _getVoiceVolume: (id) => volumes.get(id) ?? 100,
    _setVoiceVolume: (id, value) => volumes.set(id, value),
    _positionProfilePopup: () => { window.app.placed = true; }
  });
  const list = doc.getElementById('channel-list');
  const person = (id, bot = 'false') => el(doc, 'div', { class: 'channel-voice-user', 'data-user-id': String(id), 'data-is-bot': bot });
  const other = person(2);
  const robot = person(7, 'true');
  const live = el(doc, 'button', { class: 'cvu-live' });
  other.appendChild(live);
  list.appendChild(other);
  list.appendChild(robot);
  const layout = new HabitatLayout();
  layout.start();

  list.fire('click', { target: live });
  list.fire('click', { target: robot });
  assert.deepEqual(asked, [], 'the live button and a bot keep their own behaviour');
  list.fire('click', { target: other });
  assert.deepEqual(asked, [['get-user-profile', { userId: 2 }]]);
  assert.equal(window.app._profilePopupAnchor, other, 'the card opens beside the name');

  // Haven answers by putting the card on the page.
  const card = (id) => el(doc, 'div', { id: 'profile-popup', 'data-habitat-avatar-id': String(id) }, [
    el(doc, 'div', { class: 'profile-popup-body' }, [el(doc, 'div', { class: 'profile-popup-actions' })])
  ]);
  const theirs = card(2);
  doc.body.appendChild(theirs);
  FakeMutationObserver.notify(doc.body);
  const tools = theirs.querySelector('[data-habitat-voice-tools]');
  assert.ok(tools, 'someone in a voice room gets the volume row');
  assert.equal(tools.nextSibling, theirs.querySelector('.profile-popup-actions'), 'above the card\'s own buttons');
  assert.ok(window.app.placed, 'the taller card is placed again');
  const volumeButton = theirs.querySelector('[data-habitat-profile-action="volume"]');
  assert.equal(volumeButton.getAttribute('aria-expanded'), 'true');
  volumeButton.click();
  assert.equal(tools.hidden, true);
  volumeButton.click();
  assert.equal(tools.hidden, false);
  const slider = tools.querySelector('input');
  const mute = tools.querySelector('button');
  assert.equal(slider.value, '100');
  slider.value = '60';
  slider.fire('input');
  assert.equal(volumes.get(2), 60);
  assert.deepEqual(applied.at(-1), [2, 0.6]);
  mute.fire('click');
  assert.equal(volumes.get(2), 0);
  assert.equal(mute.getAttribute('aria-pressed'), 'true');
  mute.fire('click');
  assert.equal(volumes.get(2), 100);
  FakeMutationObserver.notify(doc.body);
  assert.equal(theirs.querySelectorAll('[data-habitat-voice-tools]').length, 1, 'drawn once');

  window.app.voiceChannelUsers = {};
  FakeMutationObserver.notify(list);
  assert.equal(theirs.querySelector('[data-habitat-voice-tools]'), null);
  assert.equal(volumeButton.hidden, true);
  window.app.voiceChannelUsers = { lobi: [{ id: 2 }] };
  FakeMutationObserver.notify(list);
  assert.equal(volumeButton.hidden, false);
  assert.ok(theirs.querySelector('[data-habitat-voice-tools]'));

  // Your own card, and the card of someone who is not in a voice room, stay as they are.
  theirs.remove();
  for (const id of [1, 5]) {
    const plain = card(id);
    doc.body.appendChild(plain);
    FakeMutationObserver.notify(doc.body);
    assert.equal(plain.querySelector('[data-habitat-voice-tools]'), null);
    plain.remove();
  }
  const custom = card(5);
  custom.setAttribute('class', 'profile-popup has-profile-theme');
  doc.body.appendChild(custom);
  FakeMutationObserver.notify(doc.body);
  assert.equal(custom.querySelector('[data-habitat-profile-action]'), null);
  custom.remove();
  doc.body.appendChild(theirs);
  layout.stop();
  assert.equal(theirs.querySelector('[data-habitat-profile-action]'), null);
  assert.equal(theirs.querySelector('[data-habitat-voice-tools]'), null);
  assert.equal(list.listenerCount(), 0);
});

test('the voice bar opens the connection details and drops the hash from a voice room', () => {
  const app = buildApp();
  const { doc, voiceBar } = app;
  window.app.voice = { inVoice: false, currentChannel: 'lobi' };
  window.app._isVoiceOnlyChannel = (code) => code === 'lobi';
  const layout = new HabitatLayout();
  layout.start();
  const panel = doc.querySelector('[data-habitat-connection]');
  assert.ok(panel.hidden);
  const status = el(doc, 'div', { class: 'voice-bar-status' });
  const name = el(doc, 'span', { class: 'voice-bar-channel' });
  name.textContent = '# Lobi';
  voiceBar.appendChild(status);
  voiceBar.appendChild(name);
  app.call(true);
  assert.equal(status.getAttribute('role'), 'button');
  assert.equal(status.getAttribute('tabindex'), '0');
  assert.equal(name.getAttribute('data-habitat-voice-title'), 'Lobi');
  voiceBar.getBoundingClientRect = () => ({ left: 80, top: 700, width: 260 });
  window.innerHeight = 900;
  voiceBar.fire('click', { target: status });
  assert.ok(!panel.hidden);
  assert.equal(status.getAttribute('aria-expanded'), 'true');
  assert.equal(panel.style.getPropertyValue('bottom'), '208px', 'just above the bar');
  doc.fire('keydown', { key: 'Escape', target: doc.body });
  assert.ok(panel.hidden);
  voiceBar.fire('click', { target: status });
  app.call(false);
  assert.ok(panel.hidden, 'the details close with the call');
  assert.ok(!voiceBar.hasAttribute('data-habitat-signal'));
  // The layout leaving in the middle of a call hands the bar back as Haven drew it.
  voiceBar.appendChild(status);
  voiceBar.appendChild(name);
  app.call(true);
  assert.equal(status.getAttribute('role'), 'button');
  layout.stop();
  assert.deepEqual([...status.attributes.keys()], ['class']);
  assert.deepEqual([...name.attributes.keys()], ['class']);
  assert.equal(doc.querySelector('[data-habitat-connection]'), null);
  assert.equal(FakeMutationObserver.live.size, 0);
});

test('the channel disclosure preserves its original buttons and their visibility', () => {
  const { doc } = buildApp();
  const copy = el(doc, 'button', { id: 'copy-code-btn' });
  const settings = el(doc, 'button', { id: 'channel-code-settings-btn' });
  settings.style.display = 'none';
  const box = el(doc, 'div', { id: 'header-actions-box' }, [copy, settings]);
  doc.body.appendChild(box);
  const before = snapshot(box);
  const layout = new HabitatLayout();
  layout.start();
  const menu = doc.querySelector('[data-habitat-channel-menu]');
  assert.equal(copy.parentNode, menu.querySelector('[data-habitat-channel-management]'));
  assert.equal(settings.style.display, 'none');
  layout.stop();
  assert.equal(snapshot(box), before);
});

test('calendar labels follow the member timezone across prepends and deletions without adding feed rows', () => {
  const { doc } = buildApp();
  doc.body.appendChild(el(doc, 'h3', { id: 'channel-header-name' }));
  const list = region(doc, 'message-list');
  list.setAttribute('id', 'messages');
  doc.body.appendChild(list);
  window.app._userTimeZone = () => 'America/New_York';
  const row = time => el(doc, 'div', { class: 'message', 'data-time': time });
  const first = row('2025-01-02T02:00:00Z');
  const second = row('2025-01-02T05:01:00Z');
  list.appendChild(first);
  list.appendChild(second);
  const layout = new HabitatLayout();
  layout.start();
  const label = node => node.querySelector('.habitat-day-divider');
  assert.ok(label(first) && label(second));
  assert.notEqual(label(first).textContent, label(second).textContent);
  const older = row('2025-01-02T01:00:00Z');
  list.prepend(older);
  FakeMutationObserver.notify(list);
  assert.ok(label(older));
  assert.equal(label(first), null);
  assert.deepEqual(list.children, [older, first, second]);
  older.remove();
  FakeMutationObserver.notify(list);
  assert.ok(label(first));
  layout.stop();
  assert.equal(list.querySelector('.habitat-day-divider'), null);
});

test('the room join action follows the call even when the channel title stays put', () => {
  const { doc, api } = buildApp();
  api.currentChannel = 'lobi';
  Object.assign(window.app, { _canUseVoice: () => true, _isVoiceOnlyChannel: () => true });
  const title = el(doc, 'h3', { id: 'channel-header-name' });
  title.textContent = '# Lobi';
  const indicator = el(doc, 'div', { id: 'voice-active-indicator' });
  doc.body.appendChild(title);
  doc.body.appendChild(indicator);
  doc.body.appendChild(region(doc, 'message-list'));
  const layout = new HabitatLayout();
  layout.start();
  const join = doc.querySelector('[data-habitat-join-room]');
  assert.equal(join.hidden, false);
  window.app.voice = { inVoice: true, currentChannel: 'lobi' };
  FakeMutationObserver.notify(indicator);
  assert.equal(join.hidden, true);
  window.app.voice.currentChannel = 'oyun';
  FakeMutationObserver.notify(indicator);
  assert.equal(join.hidden, false);
  layout.stop();
});

test('explicit voice room re-entry settles from the voice bar without another title or indicator change', () => {
  const { doc, api, call } = buildApp();
  const voice = { inVoice: false, currentChannel: null };
  const room = 'lobi';
  api.currentChannel = room;
  let requested = false;
  Object.assign(window.app, {
    currentChannel: room, voice, _canUseVoice: () => true, _isVoiceOnlyChannel: () => true,
    _joinVoice() { requested = true; }
  });
  const title = el(doc, 'h3', { id: 'channel-header-name' });
  title.textContent = '# Lobi';
  const indicator = el(doc, 'div', { id: 'voice-active-indicator' });
  indicator.style.display = 'none';
  const share = el(doc, 'div', { class: 'screen-share-tile', id: 'share-1' });
  const streams = region(doc, 'screen-shares', [share]);
  const area = region(doc, 'message-area', [streams, region(doc, 'message-list')]);
  doc.body.appendChild(title);
  doc.body.appendChild(indicator);
  doc.body.appendChild(area);
  const before = snapshot(doc.body);
  const layout = new HabitatLayout();
  layout.start();
  const join = doc.querySelector('[data-habitat-join-room]');
  const intro = join.parentNode;
  assert.equal(join.hidden, false);
  join.fire('click');
  assert.ok(requested);

  // The header has already settled. Only the connected bar delivers a mutation.
  Object.assign(voice, { inVoice: true, currentChannel: room });
  call(true);
  assert.ok(join.hidden, 'the live call retires the join action');
  assert.ok(intro.hidden);
  const stage = area.querySelector('[data-habitat-call-stage]');
  assert.ok(stage?.hasAttribute('data-habitat-voice-room'));
  assert.ok(stage.contains(share), 'the original shared screen is in the full-height stage');
  assert.match(HabitatLayout.CSS, /\[data-habitat-call-stage\]\[data-habitat-voice-room\] \{ flex: 1 1 auto; height: auto;/);

  voice.currentChannel = 'other';
  call(true);
  assert.equal(join.hidden, false, 'moving the call leaves the displayed room available');
  assert.equal(area.querySelector('[data-habitat-call-stage]'), null);
  voice.currentChannel = room;
  call(true);
  assert.ok(join.hidden);
  Object.assign(voice, { inVoice: false, currentChannel: null });
  call(false);
  assert.equal(join.hidden, false);
  assert.equal(intro.hidden, false);
  assert.equal(area.querySelector('[data-habitat-call-stage]'), null);
  layout.stop();
  assert.equal(snapshot(doc.body), before);
});

test('a room heading follows the start of history without adding a row to the feed', () => {
  const { doc } = buildApp();
  const title = el(doc, 'h3', { id: 'channel-header-name' });
  title.textContent = '# oyun';
  const first = el(doc, 'div', { 'data-msg-id': '1' });
  const feed = region(doc, 'message-list', [first]);
  doc.body.appendChild(title);
  doc.body.appendChild(feed);
  const layout = new HabitatLayout();
  layout.start();
  assert.equal(feed.getAttribute('data-habitat-history-title'), '');
  window.app._noMoreHistory = true;
  for (const state of ['pending', 'loading', 'failed', 'ready']) {
    feed.setAttribute('data-history', state);
    FakeMutationObserver.notify(feed);
    assert.equal(feed.getAttribute('data-habitat-history-title'), '');
  }
  feed.setAttribute('data-history', 'start');
  FakeMutationObserver.notify(feed);
  assert.equal(feed.getAttribute('data-habitat-history-title'), '# oyun');
  assert.deepEqual(feed.children, [first]);
  window.app._noMoreHistory = false;
  FakeMutationObserver.notify(feed);
  assert.equal(feed.getAttribute('data-habitat-history-title'), '');
  layout.stop();
  assert.ok(!feed.hasAttribute('data-habitat-history-title'));
});

test('the layout keeps to public regions and named buttons, and ships no remote resources', () => {
  assert.doesNotMatch(source, /https?:\/\/(?!www\.w3\.org\/2000\/svg)/i);
  // These exceptions mirror forced display in the upstream mobile toolbar
  // or replace a control that remains reachable from our own trigger.
  const forced = HabitatLayout.CSS.match(/[^{}]*\{[^}]*!important[^}]*\}/g) || [];
  assert.equal(forced.length, 8);
  assert.match(forced[0], /\[data-habitat-in-voice\] \[data-habitat-tools\] > :is\(#voice-mute-btn, #voice-deafen-btn\)/);
  // Haven writes the size of its camera and stream panels, and whether they
  // and the voice roster show at all, straight onto the elements; the call
  // stage has to outrank that, and the fixed height of a popped-out tile.
  assert.match(forced[1], /\[data-habitat-call-stage\] > :is\(\[data-habitat-stage\], #webcam-container, #screen-share-container\)\s*\{\s*display: contents !important/);
  assert.match(forced[2], /\[data-habitat-call-stage\] :is\(\.webcam-popped-out, \.stream-popped-out\)\s*\{\s*height: auto !important/);
  assert.match(forced[3], /\[data-habitat-call-stage\] :is\(\.webcam-tile, \.screen-share-tile\)\s*\{\s*max-width: none !important/);
  assert.match(forced[4], /\[data-habitat-call-stage\] :is\(\.webcam-tile, \.screen-share-tile\) > video\s*\{[^}]*max-height: none !important/);
  assert.match(forced[5], /\[data-habitat-room-members\]:not\(\[hidden\]\) \+ #mobile-users-btn/);
  assert.match(forced[6], /#header-actions-box\[style\*="display: flex"\]/);
  assert.match(forced[7], /#copy-code-btn\[style\*="inline-flex"\]/);
  for (const name of ['navigation-sidebar', 'account', 'sidebar-footer', 'sidebar-actions', 'channels',
    'join-channel', 'create-channel', 'voice-controls', 'voice-settings', 'context-sidebar']) {
    assert.match(source, new RegExp(`_region\\('${name}'\\)`), `${name} is looked up as a public region`);
  }
});

for (const [shape, options] of [
  ['desktop', { desktop: true }], ['tablet', { desktop: false }], ['phone', { desktop: false, phone: true }]
]) {
  test(`the ${shape} server list menu dispatches the original actions and restores the rail`, () => {
    const { doc, rail } = buildApp(options);
    const rows = ['add-server-btn', 'manage-servers-btn', 'sync-servers-btn'].map(id => doc.getElementById(id));
    const clicked = [];
    rows.forEach(row => row.addEventListener('click', () => clicked.push(row.id)));
    rows[1].setAttribute('data-habitat-label', 'Prior label');
    const before = snapshot(doc.body);
    const layout = new HabitatLayout();
    layout.start();
    const trigger = doc.querySelector('[data-habitat-servers-button]');
    const menu = doc.getElementById(trigger.getAttribute('aria-controls'));
    assert.equal(trigger.parentNode, options.phone ? doc.getElementById('mobile-servers-row') : rail);
    assert.equal(trigger.parentNode.children.at(-1), trigger);
    assert.deepEqual(menu.children, rows);
    for (const row of rows) {
      trigger.click();
      assert.equal(doc.activeElement, rows[0]);
      row.click();
      menu.fire('click', { target: row });
      assert.ok(menu.hidden);
      assert.equal(doc.activeElement, trigger);
    }
    assert.deepEqual(clicked, rows.map(row => row.id));
    for (const [type, event] of [['keydown', { key: 'Escape' }], ['pointerdown', { target: doc.body }]]) {
      trigger.click();
      assert.equal(trigger.getAttribute('aria-expanded'), 'true');
      doc.fire(type, event);
      assert.equal(trigger.getAttribute('aria-expanded'), 'false');
      assert.equal(doc.activeElement, trigger);
    }
    layout._disengage();
    assert.deepEqual(rail.children.slice(-3), rows);
    assert.equal(snapshot(doc.body), before);
    layout.stop();
  });
}

test('the account identity and server header open distinct actions and respect server permissions', () => {
  const { doc, header, account, create } = buildApp();
  const before = snapshot(doc.body);
  const avatar = doc.getElementById('user-bar-avatar');
  let profileOpens = 0;
  avatar.addEventListener('click', () => profileOpens++);
  doc.getElementById('rename-btn').addEventListener('click', () => profileOpens++);
  const layout = new HabitatLayout();
  layout.start();
  const accountMenu = doc.getElementById(avatar.getAttribute('aria-controls'));
  account.querySelector('.user-names').fire('click', { target: doc.getElementById('current-user') });
  assert.equal(avatar.getAttribute('aria-expanded'), 'true');
  assert.equal(profileOpens, 0);
  assert.deepEqual(accountMenu.children.map(el => el.getAttribute('data-habitat-label')), ['Edit profile', 'Logout']);
  doc.fire('keydown', { key: 'Escape' });
  assert.ok(accountMenu.hidden);
  assert.equal(doc.activeElement, avatar);
  avatar.click();
  accountMenu.children[0].click();
  accountMenu.fire('click', { target: accountMenu.children[0] });
  assert.equal(profileOpens, 1);
  assert.ok(accountMenu.hidden);
  const button = header.querySelector('[data-habitat-menu-button]');
  assert.equal(button.tagName, 'button');
  const menu = doc.getElementById(button.getAttribute('aria-controls'));
  const visible = label => !menu.querySelector('[aria-label="' + label + '"]').hidden;
  create.style.display = 'none';
  button.click();
  assert.ok(visible('Server notifications'));
  for (const label of ['Server settings', 'Create channel', 'Roles & permissions']) assert.equal(visible(label), false);
  assert.equal(menu.querySelector('#rename-btn, #logout-btn, #open-settings-btn, #status-bar-toggle'), null);
  create.style.display = 'block';
  window.app._hasAnyAdminSettingsAccess = () => true;
  window.app._hasPerm = perm => perm === 'manage_roles';
  button.click();
  button.click();
  for (const label of ['Server settings', 'Create channel', 'Roles & permissions']) assert.equal(visible(label), true);
  layout.stop();
  assert.equal(snapshot(doc.body), before);
  avatar.click();
  assert.equal(profileOpens, 2, 'the avatar resumes its native profile action');
});

test('channel actions put reading tools first and gate topic editing and rotation', () => {
  const { doc } = buildApp();
  const ids = ['channel-code-display', 'copy-code-btn', 'channel-code-settings-btn', 'pinned-toggle-btn',
    'gallery-toggle-btn', 'threads-toggle-btn', 'move-select-btn'];
  const box = el(doc, 'div', { id: 'header-actions-box' }, ids.map(id => el(doc, 'button', { id })));
  doc.body.appendChild(box);
  const rotateNow = el(doc, 'button', { id: 'code-rotate-now-btn' });
  doc.body.appendChild(rotateNow);
  let edits = 0, rotations = 0;
  rotateNow.addEventListener('click', () => rotations++);
  const channel = { code: 'room' };
  Object.assign(window.app, { channels: [channel], currentChannel: 'room', user: {},
    _editTopic: () => edits++, _hasPerm: () => false });
  const before = snapshot(doc.body);
  const layout = new HabitatLayout();
  layout.start();
  const panel = box.querySelector('[data-habitat-channel-menu]');
  assert.deepEqual(panel.children.slice(0, 3).map(el => el.id), ids.slice(3, 6));
  const group = panel.children.at(-1);
  assert.deepEqual(group.children.map(el => el.id || el.getAttribute('aria-label')),
    ['channel-code-display', 'copy-code-btn', 'Rotate channel code', 'channel-code-settings-btn', 'move-select-btn']);
  const topic = panel.querySelector('[aria-label="Set or edit topic"]');
  const rotate = group.querySelector('[aria-label="Rotate channel code"]');
  assert.ok(topic.hidden && rotate.hidden);
  window.app._hasPerm = perm => perm === 'set_channel_topic';
  panel.parentNode.fire('toggle');
  assert.ok(!topic.hidden && rotate.hidden);
  topic.click();
  rotate.click();
  assert.equal(edits, 1);
  assert.equal(rotations, 0);
  window.app.user.isAdmin = true;
  panel.parentNode.fire('toggle');
  assert.equal(rotate.hidden, false);
  rotate.click();
  assert.equal(rotations, 1);
  channel.is_dm = true;
  panel.parentNode.fire('toggle');
  assert.ok(topic.hidden && rotate.hidden);
  layout.stop();
  assert.equal(snapshot(doc.body), before);
});

test('the server actions mark changes when the same compact control moves between rail and drawer', () => {
  const { doc, phoneMedia, rail } = buildApp({ desktop: false });
  const plugin = new HabitatLayout();
  plugin.start();
  const button = doc.querySelector('[data-habitat-servers-button]');
  for (const phone of [false, true, false]) {
    phoneMedia.set(phone);
    assert.equal(button.parentNode, phone ? doc.getElementById('mobile-servers-row') : rail);
    assert.equal(button.children[0].textContent, phone ? '⋯' : '+');
    assert.ok(button.getAttribute('aria-label'));
  }
  plugin.stop();
});

test('toast clearance follows multiline input, a docked call bar and the keyboard, and restores on stop', t => {
  const { doc, voiceControls } = buildApp({ desktop: false, phone: true });
  const events = new FakeTarget();
  window.addEventListener = events.addEventListener.bind(events);
  window.removeEventListener = events.removeEventListener.bind(events);
  const composer = region(doc, 'composer');
  const workspace = region(doc, 'workspace', [composer]);
  const toast = el(doc, 'div', { id: 'toast-container' });
  doc.body.appendChild(workspace);
  doc.body.appendChild(toast);
  const property = '--hb-toast-clearance';
  toast.style.setProperty(property, '1rem');
  workspace.getBoundingClientRect = () => ({ bottom: 880 });
  let input = { top: 820, height: 60 };
  composer.getBoundingClientRect = () => input;
  let resize;
  const observed = new Set();
  globalThis.ResizeObserver = class {
    constructor(callback) { resize = callback; }
    observe(box) { observed.add(box); }
    disconnect() { observed.clear(); }
  };
  t.after(() => { delete globalThis.ResizeObserver; });
  const plugin = new HabitatLayout();
  plugin.start();
  assert.deepEqual(observed, new Set([workspace, composer, voiceControls]));
  const check = expected => {
    resize();
    assert.equal(toast.style.getPropertyValue(property), expected + 'px');
  };
  check(80);
  input = { top: 610, height: 120 };
  check(290);
  voiceControls.setAttribute('data-habitat-call-bar', '');
  check(330);
  input = { top: 0, height: 0 };
  check(60);
  voiceControls.removeAttribute('data-habitat-call-bar');
  check(20);
  plugin.stop();
  assert.equal(observed.size, 0);
  assert.equal(toast.style.getPropertyValue(property), '1rem');
});

test('a personal profile note reopens for the same account and can be cleared', async t => {
  const { doc } = buildApp();
  const saved = new Map();
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key),
  } });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else delete globalThis.localStorage;
  });
  window.t = key => key;
  const prompts = [];
  let answer = 'Lunch on Tuesday';
  const card = el(doc, 'div', {}, [el(doc, 'div', { class: 'profile-popup-actions' })]);
  const layout = new HabitatLayout();
  Object.assign(window.app, { user: { id: 2 }, _closeProfilePopup() {},
    _showPromptModal(label, hint, value) { prompts.push(value); return answer; },
  });
  layout._profileActions(card, 5, false);
  const note = card.querySelector('[data-habitat-profile-action="note"]');
  note.click();
  await Promise.resolve();
  window.app.user = { id: 3 };
  answer = null;
  note.click();
  await Promise.resolve();
  window.app.user = { id: 2 };
  answer = '';
  note.click();
  await Promise.resolve();
  assert.deepEqual(prompts, ['', '', 'Lunch on Tuesday']);
  assert.equal(saved.size, 0);
});
