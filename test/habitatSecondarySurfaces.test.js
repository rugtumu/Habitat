'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { parseHtml } = require('./fakeDom');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const app = read('public/app.html');
const css = read('themes/habitat-grafit.theme.css').replace(/\/\*[\s\S]*?\*\//g, '');
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => [selector.trim(), body]);

function hasRule(selector, declarations) {
  assert.ok(rules.some(([s, body]) => s.includes(selector) && declarations.every(d => body.includes(d))),
    selector + ' should set ' + declarations.join(', '));
}

test('thread groups and composer share a face column and density-dependent spacing in both panel modes', () => {
  hasRule('#thread-panel .thread-msg-row', ['gap: var(--thread-gap)', 'padding: .25rem 0']);
  hasRule('#thread-panel .thread-input-area', ['gap: var(--thread-gap)', 'margin: .5rem var(--thread-inset)']);
  hasRule('#thread-emoji-btn', ['width: var(--thread-face)']);
  for (const density of ['compact', 'spacious']) hasRule('html[data-haven-density="' + density + '"] #thread-panel', ['--thread-gap:']);
  assert.match(app, /id="thread-emoji-btn"[^\n]*\n\s*<textarea[^>]*id="thread-input"/);
  hasRule('#thread-messages:empty + .thread-status', ['display: block']);
  hasRule('#thread-messages[data-failed] + .thread-status .thread-empty', ['display: none']);
  hasRule('#threads-list-body .thread-list-row', ['padding: .75rem', 'border-radius: var(--radius)']);
});

test('search and both pin lists share keyboard rows, with separate permission-gated unpin actions', () => {
  const search = read('public/js/modules/app-search.js');
  const pins = read('public/js/modules/app-message-tools.js');
  for (const row of ['.search-result-item', '.pinned-item']) {
    hasRule(row, ['padding: .75rem', 'border-radius: var(--radius)']);
    hasRule(row, ['outline: .125rem solid var(--accent)']);
  }
  assert.match(search, /class="search-result-item" role="link" tabindex="0"/);
  assert.match(pins, /class="pinned-item" role="link" tabindex="0"/);
  assert.match(pins, /canUnpin \? `<button class="pinned-unpin-btn/);
  hasRule('.pinned-item:is(:hover, :focus-within) .pinned-unpin-btn', ['opacity: 1']);
  hasRule('#search-filter-popover .sfp-sort-btn.active', ['color: var(--accent)']);
  hasRule('#search-panel .search-result-content mark', ['background: var(--accent-glow)']);
});

test('gallery tiles keep the size preference, filename caption and selection outline', () => {
  hasRule('#media-gallery-body .media-gallery-grid', ['gap: .5rem', 'var(--media-tile']);
  hasRule('#media-gallery-body .media-grid-item', ['border-radius: var(--radius)']);
  hasRule('.media-grid-item.selected', ['outline: .125rem solid var(--accent)']);
  hasRule('.media-grid-item:not(:hover, :focus-within) .media-grid-name', ['display: none']);
  assert.equal(read('public/js/modules/app-media-gallery.js').match(/class="media-grid-name">\$\{esc\(fileName\(it\)\)\}/g).length, 2);
});

test('the emoji, reaction and GIF pickers share a popover and adapt their targets to touch', () => {
  hasRule(':is(#emoji-picker, #gif-picker, .reaction-picker, .reaction-full-picker)',
    ['--picker-cell: 2rem', 'border-radius: var(--hb-radius-lg)', 'box-shadow: var(--hb-elev-popover)']);
  assert.match(css, /@media \(pointer: coarse\)\s*\{\s*:is\(#emoji-picker,[^{]+\{ --picker-cell: 2.5rem/);
  hasRule('.reaction-picker .reaction-pick-btn', ['width: var(--picker-cell)', 'border-radius: var(--radius-sm)']);
  hasRule('#gif-grid', ['grid-template-columns: repeat(2, minmax(0, 1fr))', 'gap: .5rem']);
});

test('both media viewers use one toolbar, scrim and set of target sizes', () => {
  hasRule(':is(#image-lightbox, #video-lightbox)', ['background: var(--hb-scrim)']);
  hasRule('.image-lightbox .lightbox-bar button', ['width: 2.5rem', 'height: 2.5rem']);
  hasRule('.image-lightbox .lightbox-nav', ['width: 3rem', 'height: 3rem']);
  for (const file of ['app-media', 'app-media-gallery']) assert.match(read('public/js/modules/' + file + '.js'), /this\._lightboxBar\(/);
});

test('Link Server and admin recovery remain operable inside the login disclosure', () => {
  const source = read('public/index.html');
  const form = parseHtml(source.match(/<form id="login-form"[\s\S]*?<\/form>/)[0])[0];
  const details = form.children.find(node => node.tag === 'details');
  assert.ok(details && !('hidden' in details.attrs) && !details.attrs.style);
  assert.equal(details.children[0].tag, 'summary');
  assert.equal(details.children[0].children[0].text, 'Other ways to sign in');
  const actions = details.children.slice(1);
  assert.deepEqual(actions.map(node => node.attrs['data-tab'] || node.attrs.id), ['sso', 'admin-recover-show']);
  assert.equal(actions[0].attrs.type, 'button');
  assert.ok(actions[0].attrs.class.split(' ').includes('auth-tab'));
  assert.equal(actions[1].attrs.href, '#');
  const tabBar = source.match(/<div class="auth-tabs">[\s\S]*?<\/div>/)[0];
  assert.deepEqual([...tabBar.matchAll(/data-tab="(.*?)"/g)].map(m => m[1]), ['login', 'register']);
  assert.match(source, /<details class="auth-appearance"/);
  hasRule('[data-haven-page="auth"] .auth-form .btn-primary', ['width: 100%']);
  hasRule('[data-haven-page="auth"] .auth-error', ['color: var(--danger)']);
});

test('generic dialogs use the shared header, body, footer and danger styles', () => {
  hasRule('.modal-overlay > .modal:not(', ['padding: 1.5rem', 'border-radius: var(--hb-radius-lg)']);
  hasRule('.modal-overlay > .modal > h3', ['font-size: var(--hb-text-lg)', 'font-weight: 600']);
  hasRule('.modal-overlay > .modal > :is(p, .modal-desc)', ['color: var(--text-secondary)', 'font-size: var(--hb-text-sm)']);
  hasRule('.modal-overlay > .modal > .modal-actions', ['justify-content: flex-end', 'gap: .5rem']);
  hasRule('.modal-overlay > .modal .btn-danger-fill', ['background: var(--danger)']);
});
