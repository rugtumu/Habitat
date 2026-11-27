'use strict';

// Habitat fork: Settings is five member pages and four admin pages. Every
// section in the page must be on exactly one of them (a section left out
// would surface as a "More" page), and the page Settings opens on must not
// hold the account sections, which ask the server for sessions, two-factor
// state and recovery codes as soon as they are shown.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const source = read('public/js/modules/app-settings-pages.js');
const html = read('public/app.html');
const en = JSON.parse(read('public/locales/en.json'));

const map = source.slice(source.indexOf('const SETTINGS_PAGES'), source.indexOf('export default'));
const pagesOf = (side) => {
  const from = map.indexOf(side + ': [');
  const to = side === 'user' ? map.indexOf('admin: [') : map.length;
  return [...map.slice(from, to).matchAll(/\['([a-z]+)', '[^']+', '(settings\.pages\.[a-z_]+)', '([^']+)', \[([^\]]*)\]\]/g)]
    .map((m) => ({ id: m[1], key: m[2], label: m[3], sections: [...m[4].matchAll(/'(section-[a-z0-9-]+)'/g)].map((s) => s[1]) }));
};
const user = pagesOf('user');
const admin = pagesOf('admin');

test('members see five pages and admins four', () => {
  assert.deepEqual(user.map((p) => p.label), ['Interface & accessibility', 'Chat & media', 'Voice & video', 'Notifications', 'Profile & account']);
  assert.deepEqual(admin.map((p) => p.label), ['Server & channels', 'People & safety', 'Content & integrations', 'Operations']);
});

test('every section in the page is on exactly one page', () => {
  const inPage = (cls) => [...html.matchAll(new RegExp('<div class="' + cls + '[^"]*" id="(section-[a-z0-9-]+)"', 'g'))].map((m) => m[1]).sort();
  for (const [pages, cls] of [[user, 'settings-section'], [admin, 'admin-settings']]) {
    const mapped = pages.flatMap((p) => p.sections);
    assert.equal(new Set(mapped).size, mapped.length, 'no section is listed twice');
    assert.deepEqual([...mapped].sort(), inPage(cls));
  }
});

test('each page has an English label and Settings opens away from the account sections', () => {
  for (const page of [...user, ...admin]) {
    const text = page.key.split('.').reduce((node, part) => node && node[part], en);
    assert.equal(text, page.label, page.key);
  }
  const opens = source.match(/this\._spPage = \{ user: '([a-z]+)', admin: '([a-z]+)' \}/);
  assert.ok(opens, 'the opening pages are set');
  const first = user.find((p) => p.id === opens[1]);
  assert.ok(first, 'the member opening page exists');
  for (const lazy of ['section-sessions', 'section-2fa', 'section-recovery']) assert.ok(!first.sections.includes(lazy), lazy);
  assert.ok(admin.some((p) => p.id === opens[2]), 'the admin opening page exists');
});
