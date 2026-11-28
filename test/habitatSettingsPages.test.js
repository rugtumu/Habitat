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

test('jump links follow the on-screen order within each page', () => {
  for (const page of [...user, ...admin]) {
    const rendered = [...html.matchAll(/<div class="(?:settings-section|admin-settings)" id="([^"]+)"/g)]
      .map(match => match[1]).filter(id => page.sections.includes(id));
    assert.deepEqual(rendered, page.sections, page.label);
  }
});

test('each new privacy section has the matching legacy navigation, page, and English heading', () => {
  for (const [pages, page, id, side, key, titleKey, title] of [
    [user, 'chat', 'section-content-privacy', 'user', 'content_privacy', 'content_privacy.title', 'Content & privacy'],
    [admin, 'network', 'section-privacy', 'admin-group', 'privacy', 'admin.privacy_title', 'Privacy & delivery'],
  ]) {
    const nav = html.split('class="settings-nav-' + side + '"')[1].split('\n          </div>')[0];
    const navClass = pages === admin ? 'settings-nav-item settings-nav-admin' : 'settings-nav-item';
    assert.match(nav, new RegExp('class="' + navClass + '" data-target="' + id + '"[^>]*>[^<]*<span data-i18n="settings.nav.' + key + '"'));
    assert.ok(pages.find(p => p.id === page).sections.includes(id));
    assert.equal(en.settings.nav[key], title);
    assert.equal(titleKey.split('.').reduce((node, part) => node[part], en.settings), title);
    assert.ok(html.includes('data-i18n="settings.' + titleKey + '"'));
  }
  assert.match(read('public/js/modules/app-admin.js'), /'section-privacy':\s*\[\]/);
});

test('each moved control has one home and its original ID-based consumer', () => {
  const sections = [...html.matchAll(/^([ ]*)<div class="(?:settings-section|admin-settings)" id="(section-[\w-]+)"[^>]*>([\s\S]*?)^\1<\/div>/gm)];
  for (const [home, module, ids] of [
    ['content-privacy', 'context', ['hide-nsfw-channels', 'blur-nsfw-topics']],
    ['call-settings', 'context', ['auto-accept-streams', 'hide-voice-panel', 'sidebar-voice-controls', 'notif-voice-action-cues-enabled']],
    ['call-settings', 'media', ['pref-voice-mute-on-join', 'pref-voice-listener-only']],
    ['update-preferences', 'admin', ['update-banner-admin-only', 'update-channel-early']],
    ['channel-types', 'admin', ['category-layout-tabs', 'hide-disabled-badges']],
    ['connectivity', 'moderation', ['voice-force-relay']],
    ['privacy', 'admin', ['referrer-policy-select']],
    ['privacy', 'moderation', ['media-proxy-enabled', 'media-cache-stats', 'fcm-enabled', 'fcm-hide-content']],
  ]) {
    const consumer = read('public/js/modules/app-' + module + '.js');
    for (const id of ids) {
      const attr = 'id="' + id + '"';
      assert.equal(html.split(attr).length, 2, id);
      assert.deepEqual(sections.filter(m => m[3].includes(attr)).map(m => m[2]), ['section-' + home], id);
      assert.match(consumer, new RegExp("(?:getElementById|on|bool)\\('" + id + "'"), id);
    }
  }
  const section = id => sections.find(m => m[2] === 'section-' + id)[3];
  assert.deepEqual([...section('score-badges').matchAll(/type="checkbox" id="([^"]+)"/g)].map(m => m[1]), ['hide-other-scores', 'hide-own-score']);
  assert.ok(section('members').includes('id="allow-self-purge"'));
  assert.ok(section('sounds').includes('id="notif-server-mute-mode"'));
});

test('cancelling an edit restores all four moved release and channel appearance switches', () => {
  const vm = require('node:vm');
  const controls = Object.fromEntries(['update-banner-admin-only', 'update-channel-early', 'category-layout-tabs', 'hide-disabled-badges']
    .map(id => [id, { checked: false }]));
  const modal = { style: {} };
  const document = { getElementById: id => id === 'settings-modal' ? modal : controls[id] };
  const methods = vm.runInNewContext(read('public/js/modules/app-admin.js').replace('export default {', '({').replace(/};\s*$/, '})'), { document });
  const app = { ...methods, _hasPerm: () => false, serverSettings: { update_banner_admin_only: 'true', update_channel_early: 'true', category_layout: 'tabs', hide_disabled_channel_badges: 'true' } };
  app._snapshotAdminSettings();
  app._cancelAdminSettings();
  for (const [id, control] of Object.entries(controls)) assert.equal(control.checked, true, id);
});
