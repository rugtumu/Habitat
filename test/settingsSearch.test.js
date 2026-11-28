'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const HTML = read('public/app.html');
const SOURCE = read('public/js/modules/app-forum.js');
const el = (props) => {
  const classes = new Set(props.classes || []);
  return { ...props, scrollTop: 50, classList: { contains: c => classes.has(c), toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)) } };
};
const hidden = (node) => node.classList.contains('settings-search-hidden');
function buildDom() {
  const marks = [...HTML.matchAll(/<div class="(settings-section[^"]*|admin-settings)" id="([^"]+)"/g)];
  const panelAt = HTML.indexOf('id="admin-mod-panel"');
  const units = marks.map((m, i) => el({ id: m[2], style: {}, querySelectorAll: () => [], classes: m[1].split(' '), inPanel: m.index > panelAt && m[1] === 'admin-settings', textContent: HTML.slice(m.index, marks[i + 1]?.index ?? HTML.indexOf('/settings-body-admin')).replace(/<[^>]+>/g, ' ') }));
  const adminGroupAt = HTML.indexOf('class="settings-nav-admin-group"');
  const navMarks = [...HTML.slice(0, HTML.indexOf('</nav>', adminGroupAt)).matchAll(/<div class="(settings-nav-item|settings-nav-group-label)[^"]*"(?:[^>]*data-target="([^"]+)")?/g)];
  const navNodes = navMarks.map(m => el({ classes: [m[1]], target: m[2], dataset: { target: m[2] }, admin: m.index > adminGroupAt, style: {} }));
  navNodes.forEach((n, i) => { n.nextElementSibling = navNodes[i + 1]?.admin === n.admin ? navNodes[i + 1] : null; });
  const bodies = [el({ id: 'settings-body-user' }), el({ id: 'settings-body-admin' })];
  const matchOne = (sel, u) => sel === '.settings-section:not(#admin-mod-panel)' ? u.classList.contains('settings-section') && u.id !== 'admin-mod-panel' : sel === '#admin-mod-panel > .admin-settings' ? u.inPanel : sel === '.settings-section' && u.classList.contains('settings-section');
  const input = { value: '', listeners: {}, addEventListener(type, fn) { this.listeners[type] = fn; } };
  const nav = { insertBefore() {}, querySelector: sel => navNodes.find(n => n.classList.contains('settings-nav-item') && sel === `.settings-nav-item[data-target="${n.target}"]`) || null, querySelectorAll: sel => sel === '.settings-nav-group-label' ? navNodes.filter(n => n.classList.contains('settings-nav-group-label')) : [] };
  const modal = { addEventListener() {}, querySelectorAll: sel => sel === '.settings-body' ? bodies : units.filter(u => sel.split(',').some(s => matchOne(s.trim(), u))) };
  const document = { getElementById: id => ({ 'settings-nav': nav, 'settings-modal': modal })[id] || units.find(u => u.id === id) || null,
    querySelector: () => null,
    querySelectorAll: selector => {
      if (selector === '.settings-nav-item.settings-nav-admin') return navNodes.filter(n => n.admin && n.target);
      if (selector === '#admin-mod-panel .admin-settings') return units.filter(u => u.inPanel);
      return [];
    },
    createElement: () => ({ querySelector: () => input }) };
  return { document, input, units, navNodes, bodies };
}
function search(query, user) {
  const dom = buildDom();
  const context = vm.createContext({ module: { exports: {} }, document: dom.document, t: k => k, localStorage: { getItem: () => null }, console });
  if (user) {
    const admin = read('public/js/modules/app-admin.js');
    vm.runInContext(admin.replace(/^export default/m, 'module.exports ='), context);
    context.module.exports._syncSettingsNav.call({ user, _hasPerm: key => user.permissions.includes(key) });
  }
  vm.runInContext(SOURCE.replace(/^export default/m, 'module.exports ='), context, { filename: 'app-forum.js' });
  context.module.exports._setupSettingsSearch.call({});
  dom.input.value = query;
  dom.input.listeners.input();
  const unit = id => dom.units.find(u => u.id === id);
  const navItem = id => dom.navNodes.find(n => n.target === id);
  return { ...dom, unit, navItem };
}
test('admin settings are searched one section at a time', () => {
  const r = search('role');
  assert.equal(hidden(r.unit('section-roles')), false);
  assert.equal(hidden(r.navItem('section-roles')), false);
  assert.equal(hidden(r.unit('section-update')), true);
  assert.equal(hidden(r.navItem('section-update')), true);
  assert.equal(hidden(r.navItem('section-branding')), true);
  assert.equal(hidden(r.unit('admin-mod-panel')), false);
});
test('every admin nav entry points at a section the search can hide', () => {
  const r = search('zzzz-no-such-setting');
  const adminItems = r.navNodes.filter(n => n.admin && n.target);
  assert.ok(adminItems.length > 20);
  adminItems.forEach(n => assert.equal(hidden(n), true, n.target));
});
test('user settings still filter and the body scrolls back to the top', () => {
  const r = search('zoom');
  assert.equal(hidden(r.unit('section-zoom')), false);
  assert.equal(hidden(r.unit('section-password')), true);
  assert.equal(hidden(r.navItem('section-password')), true);
  r.bodies.forEach(b => assert.equal(b.scrollTop, 0));
});
test('clearing the query shows everything again', () => {
  const r = search('role');
  r.input.value = '';
  r.input.listeners.input();
  r.units.forEach(u => assert.equal(hidden(u), false, u.id));
  r.navNodes.forEach(n => assert.equal(hidden(n), false));
});

test('Privacy & delivery is admin-only in Operations and in matching search results', () => {
  for (const user of [{ permissions: ['invite_users'] }, { permissions: ['manage_server'] }, { isAdmin: true, permissions: [] }]) {
    for (const query of ['', 'referrer', 'fcm']) {
      const r = search(query, user);
      const id = 'section-privacy';
      const sec = r.unit(id);
      const allowed = !!user.isAdmin;
      assert.equal(r.navItem(id).style.display !== 'none', allowed);
      assert.equal(sec.style.display !== 'none' && !sec.hidden, allowed);
      if (query) assert.equal(!hidden(sec), allowed);
      const pages = vm.runInNewContext(read('public/js/modules/app-settings-pages.js').replace('export default {', '({').replace(/};\s*$/, '})'), { document: r.document });
      const app = { _spSides: { admin: { nav: r.document.getElementById('settings-nav') } } };
      assert.equal(pages._spAvailable.call(app, 'admin', id), allowed);
      assert.equal(pages._spAvailable.call(app, 'admin', 'section-invite'), true);
    }
  }
});

test('Manage Server can find release preferences while the update and shutdown controls stay admin-only', () => {
  for (const user of [{ permissions: [] }, { permissions: ['manage_server'] }, { isAdmin: true, permissions: [] }]) {
    const allowed = !!user.isAdmin || user.permissions.includes('manage_server');
    const r = search('Early access updates', user);
    const id = 'section-update-preferences';
    assert.equal(r.navItem(id).style.display !== 'none', allowed);
    assert.equal(r.unit(id).style.display !== 'none' && !hidden(r.unit(id)), allowed);
    assert.equal(r.unit('section-update').style.display !== 'none', !!user.isAdmin);
    assert.equal(r.navItem('section-update').style.display !== 'none', !!user.isAdmin);
  }
});
