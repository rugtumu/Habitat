'use strict';

// Habitat fork: holding Shift puts Delete on a hovered message's bar, so a
// message can be removed without opening the More menu. It must stay out of
// sight otherwise, must not be offered on a message the member cannot delete,
// and must not get stuck on when Shift is released in another window.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const messages = read('public/js/modules/app-messages.js');
const actions = read('public/js/modules/app-message-actions.js');
const css = read('public/css/style-emoji-reactions-threads.css');

test('the Shift Delete button is only built for a message the member may delete', () => {
  const built = messages.match(/const shiftDeleteHtml = ([^?]+)\?/);
  assert.ok(built, 'the button is built in the message renderer');
  assert.match(built[1], /canDelete/, 'the same permission as the menu item decides it');
  assert.match(built[1], /visibleActions\.some\(a => a\.key === 'delete'\)/, 'no second button when Delete is already on the bar');
  assert.match(messages, /class="msg-shift-delete" data-action="delete"/, 'it runs the ordinary delete action, with its permission and protection checks');
});

test('the button is hidden until Shift is held, then shown in the danger colour', () => {
  assert.match(css, /\.msg-toolbar button\.msg-shift-delete \{ display: none; \}/);
  assert.match(css, /html\.shift-held \.msg-toolbar button\.msg-shift-delete \{ display: flex; \}/);
  assert.match(css, /html\.shift-held \.msg-toolbar button\[data-action="delete"\][^{]*\{ color: var\(--danger\); \}/);
});

test('a Shift click deletes at once, a plain click still asks, and a protected message is refused either way', () => {
  const branch = actions.slice(actions.indexOf("} else if (action === 'delete') {"), actions.indexOf("} else if (action === 'pin') {"));
  assert.match(branch, /if \(e\.shiftKey \|\| await this\._showConfirmModal\(t\('confirm\.delete_message'\)/, 'only Shift skips the question');
  assert.ok(branch.indexOf("dataset.archived === '1'") < branch.indexOf('e.shiftKey'), 'the protected check comes before the shortcut');
});

test('releasing Shift, or leaving the window with it held, clears the mark', () => {
  assert.match(actions, /addEventListener\('keydown', \(e\) => \{ if \(e\.key === 'Shift'\) shiftHeld\(true\); \}\)/);
  assert.match(actions, /addEventListener\('keyup', \(e\) => \{ if \(e\.key === 'Shift'\) shiftHeld\(false\); \}\)/);
  assert.match(actions, /window\.addEventListener\('blur', \(\) => shiftHeld\(false\)\)/);
});
