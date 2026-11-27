'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.join(__dirname, '..');
const FILE = 'HabitatLayout.plugin.js';
const source = fs.readFileSync(path.join(ROOT, 'plugins', FILE), 'utf8');
const HabitatLayout = require('../plugins/HabitatLayout.plugin.js');

// ── A DOM just large enough for the plugin ─────────────────
class FakeTarget {
  constructor() { this.listeners = new Map(); this.captured = new Set(); }
  addEventListener(type, listener, options) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
    if (options === true || options?.capture) this.captured.add(type);
  }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
  listenerCount() { return [...this.listeners.values()].reduce((sum, set) => sum + set.size, 0); }
  fire(type, init = {}) {
    const event = { type, target: this, stopped: false, stopPropagation() { this.stopped = true; }, ...init };
    for (const listener of [...(this.listeners.get(type) || [])]) listener.call(this, event);
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
  constructor(callback) { this.callback = callback; this.target = null; FakeMutationObserver.live.add(this); }
  observe(target) { this.target = target; }
  disconnect() { FakeMutationObserver.live.delete(this); this.target = null; }
  static notify(target) {
    for (const observer of [...FakeMutationObserver.live]) if (observer.target === target) observer.callback([]);
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
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
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
    return [...found];
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

class FakeDocument extends FakeTarget {
  constructor() {
    super();
    this.documentElement = new FakeElement('html', this);
    this.documentElement.lang = 'en';
    this.body = new FakeElement('body', this);
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
    button('mentions-btn', 'Mentions and replies'),
    button('rename-btn', 'Change display name'),
    button('logout-btn', 'Logout')
  ]);
  const header = el(doc, 'div', { id: 'sidebar-header' }, [el(doc, 'div', { id: 'brand' }), account]);
  const field = () => el(doc, 'input', { type: 'text' });
  const join = region(doc, 'join-channel', [el(doc, 'div', {}, [field(), button('join-channel-btn')])]);
  const create = region(doc, 'create-channel', [el(doc, 'div', {}, [field(), button('create-channel-btn')])]);
  const channels = region(doc, 'channels', [el(doc, 'h5', { id: 'channels-toggle' }), el(doc, 'div', { id: 'channel-list' })]);
  const content = region(doc, 'sidebar-content', [join, create, channels, region(doc, 'direct-messages')]);
  const actions = region(doc, 'sidebar-actions', [
    button('theme-popup-toggle', 'Theme'),
    button('activities-btn', 'Activities'),
    el(doc, 'span'),
    button('donors-btn'),
    button('voice-mute-btn', 'Mute'),
    button('voice-deafen-btn', 'Deafen')
  ]);
  // Haven draws the voice bar only during a call; outside one it is hidden and empty.
  const voiceBar = el(doc, 'div', { id: 'voice-bar' });
  voiceBar.style.display = 'none';
  const footer = region(doc, 'sidebar-footer', [el(doc, 'div', { id: 'theme-popup' }), voiceBar, actions]);
  const navigation = region(doc, 'navigation-sidebar', [header, content, footer], 'aside');
  const voiceControls = region(doc, 'voice-controls');
  voiceControls.style.setProperty('position', 'absolute');
  const context = region(doc, 'context-sidebar', [
    region(doc, 'voice-roster'),
    region(doc, 'member-list'),
    region(doc, 'voice-settings'),
    voiceControls,
    el(doc, 'div', { id: 'settings-panel' }, [button('open-settings-btn', 'Settings')])
  ], 'aside');
  doc.body.appendChild(el(doc, 'div', { id: 'app' }, [navigation, region(doc, 'main'), context]));
  doc.getElementById('app').appendChild(button('status-bar-toggle', 'Toggle status bar'));
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
  return { doc, media, phoneMedia, composerRefreshes, voiceBar, call, data, styles, api, account, header, footer, actions, join, create, channels, context, voiceControls };
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
  for (const id of ['theme-popup-toggle', 'activities-btn', 'donors-btn', 'rename-btn', 'logout-btn', 'status-bar-toggle']) {
    assert.ok(menu.contains(app.doc.getElementById(id)), `${id} is in the server menu`);
  }
  const body = app.doc.querySelector('[data-habitat-dialog-body]');
  assert.deepEqual(body.children, [app.join, app.create]);
  assert.ok(app.channels.querySelector('[data-habitat-add-button]'), 'the channel list offers the + button');
  plugin.stop();
});

test('switching the layout off puts every element back where it was', () => {
  const app = buildApp();
  const before = snapshot(app.doc.documentElement);
  const plugin = new HabitatLayout();
  plugin.start();
  assert.notEqual(snapshot(app.doc.documentElement), before);

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
  assert.equal(app.doc.querySelectorAll('[data-habitat-menu]').length, 1, 'nothing is built twice');
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
  assert.equal(app.doc.getElementById('donors-btn').getAttribute('data-habitat-label'), 'Supporters');

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

test('the add channel dialog opens from +, and closes on Escape or a real submit', async () => {
  const app = buildApp({ lang: 'tr' });
  const plugin = new HabitatLayout();
  plugin.start();
  const dialog = app.doc.querySelector('[data-habitat-dialog]');
  const add = app.channels.querySelector('[data-habitat-add-button]');
  const body = app.doc.querySelector('[data-habitat-dialog-body]');
  const codeField = app.join.querySelector('input[type="text"]');
  assert.equal(add.getAttribute('aria-label'), 'Kanal ekle');
  assert.equal(add.parentNode.getAttribute('id'), 'channels-toggle');

  const click = add.fire('click');
  assert.ok(click.stopped, 'the click must not also collapse the channel list');
  assert.equal(dialog.hidden, false);
  assert.equal(app.doc.activeElement, codeField);

  const escape = app.doc.fire('keydown', { key: 'Escape' });
  assert.ok(dialog.hidden);
  assert.ok(escape.stopped);
  assert.equal(app.doc.activeElement, add, 'focus returns to the button that opened it');

  add.fire('click');
  body.fire('click', { target: app.doc.getElementById('join-channel-btn') });
  await tick();
  assert.equal(dialog.hidden, false, 'an empty code keeps the dialog open');

  codeField.value = 'a1b2c3d4';
  body.fire('click', { target: app.doc.getElementById('join-channel-btn') });
  await tick();
  assert.ok(dialog.hidden);
  // The app's own handler empties the field as it submits, so the dialog has
  // to read it first: in the capture phase, on the way down to the button.
  assert.ok(body.captured.has('click'), 'the submit click is read before the app clears the field');
  assert.ok(body.captured.has('keydown'), 'Enter is read before the app clears the field');

  add.fire('click');
  dialog.fire('pointerdown', { target: dialog });
  assert.ok(dialog.hidden, 'a press on the backdrop closes it');
  plugin.stop();
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
  assert.equal(close.parentNode, roster);
  assert.equal(doc.querySelector('[data-habitat-call-stage]'), null, 'the empty stage leaves the page');
  indicator.style.display = 'flex';
  FakeMutationObserver.notify(indicator);
  toggle.fire('click');
  layout.stop();
  assert.equal(snapshot(doc.body), before);
});

// A call with a roster, Haven's camera and stream panels, and a stage of a known size.
function buildCall({ people = 2, width = 1000, height = 600, desktop = true } = {}) {
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

test('on a desktop the call buttons stay docked in the sidebar footer', () => {
  const { area, footer, voiceControls, layout } = buildCall();
  assert.equal(voiceControls.parentNode, footer);
  assert.ok(!voiceControls.hasAttribute('data-habitat-call-bar'));
  assert.ok(!area.contains(voiceControls));
  layout.stop();
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
  assert.equal(copy.parentNode, menu);
  assert.equal(settings.style.display, 'none');
  layout.stop();
  assert.equal(snapshot(box), before);
});

test('a room heading follows the start of history without adding a row to the feed', () => {
  const { doc } = buildApp();
  doc.body.classList = { contains: () => false };
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
  assert.equal(forced.length, 7);
  assert.match(forced[0], /\[data-habitat-in-voice\] \[data-habitat-tools\] > :is\(#voice-mute-btn, #voice-deafen-btn\)/);
  // Haven writes the size of its camera and stream panels, and whether they
  // show, straight onto the elements; the call stage has to outrank that.
  assert.match(forced[1], /\[data-habitat-call-stage\] > :is\(#webcam-container, #screen-share-container\)\[style\*="display: flex"\]\s*\{\s*display: contents !important/);
  assert.match(forced[2], /\[data-habitat-call-stage\] :is\(\.webcam-tile, \.screen-share-tile\)\s*\{\s*max-width: none !important/);
  assert.match(forced[3], /\[data-habitat-call-stage\] :is\(\.webcam-tile, \.screen-share-tile\) > video\s*\{[^}]*max-height: none !important/);
  assert.match(forced[4], /\[data-habitat-room-members\]:not\(\[hidden\]\) \+ #mobile-users-btn/);
  assert.match(forced[5], /#header-actions-box\[style\*="display: flex"\]/);
  assert.match(forced[6], /#copy-code-btn\[style\*="inline-flex"\]/);
  for (const name of ['navigation-sidebar', 'account', 'sidebar-footer', 'sidebar-actions', 'channels',
    'join-channel', 'create-channel', 'voice-controls', 'voice-settings', 'context-sidebar']) {
    assert.match(source, new RegExp(`_region\\('${name}'\\)`), `${name} is looked up as a public region`);
  }
});
