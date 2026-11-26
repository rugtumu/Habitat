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
}

function parseCompound(selector) {
  const out = { tag: null, id: null, attrs: [] };
  let rest = selector.trim();
  const tag = rest.match(/^[a-zA-Z][\w-]*/);
  if (tag) { out.tag = tag[0].toLowerCase(); rest = rest.slice(tag[0].length); }
  const part = /^(?:#([\w-]+)|\[([\w-]+)(?:="([^"]*)")?\])/;
  while (rest) {
    const hit = rest.match(part);
    if (!hit) throw new Error(`Unsupported selector in test DOM: ${selector}`);
    if (hit[1]) out.id = hit[1]; else out.attrs.push([hit[2], hit[3]]);
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
  }
  get parentElement() { return this.parentNode; }
  get nextSibling() {
    if (!this.parentNode) return null;
    return this.parentNode.children[this.parentNode.children.indexOf(this) + 1] || null;
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
      const pool = scoped ? this.children : this.descendants();
      for (const node of pool) if (node.matches(scoped ? scoped[1] : single)) found.add(node);
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
  const footer = region(doc, 'sidebar-footer', [el(doc, 'div', { id: 'theme-popup' }), actions]);
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
  return { doc, media, phoneMedia, composerRefreshes, data, styles, api, account, header, footer, actions, join, create, channels, context, voiceControls };
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
  delete globalThis.window;
  delete globalThis.HavenApi;
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
  for (const id of ['theme-popup-toggle', 'activities-btn', 'donors-btn', 'rename-btn', 'logout-btn']) {
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
  assert.deepEqual(app.composerRefreshes, []);
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

test('the layout keeps to public regions and named buttons, and ships no remote resources', () => {
  assert.doesNotMatch(source, /https?:\/\/(?!www\.w3\.org\/2000\/svg)/i);
  assert.doesNotMatch(HabitatLayout.CSS, /!important/);
  for (const name of ['navigation-sidebar', 'account', 'sidebar-footer', 'sidebar-actions', 'channels',
    'join-channel', 'create-channel', 'voice-controls', 'voice-settings', 'context-sidebar']) {
    assert.match(source, new RegExp(`_region\\('${name}'\\)`), `${name} is looked up as a public region`);
  }
});
