'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const HabitatLayout = require('../plugins/HabitatLayout.plugin.js');

const ROOT = path.join(__dirname, '..');
const theme = fs.readFileSync(path.join(ROOT, 'themes/habitat-grafit.theme.css'), 'utf8');
const accessibility = fs.readFileSync(path.join(ROOT, 'public/css/style-accessibility.css'), 'utf8');

function keyframes(css) {
  return [...css.matchAll(/@keyframes\s+([\w-]+)\s*\{((?:[^{}]*\{[^{}]*\})*)\s*\}/g)]
    .map(([, name, body]) => ({ name, properties: [...body.matchAll(/([\w-]+)\s*:/g)].map((hit) => hit[1]) }));
}

// Cheap to draw, and they add to an element's own transform instead of replacing it.
const CHEAP = new Set(['opacity', 'translate', 'scale', 'rotate']);

test('Habitat animations only move what is cheap to draw', () => {
  for (const [where, css] of [['theme', theme], ['layout plugin', HabitatLayout.CSS]]) {
    const frames = keyframes(css);
    assert.ok(frames.length > 0, `${where} defines its animations`);
    for (const { name, properties } of frames) {
      for (const property of properties) {
        assert.ok(CHEAP.has(property), `${where}: @keyframes ${name} animates ${property}`);
      }
    }
  }
});

test('an animation never replaces the transform Haven positions an element with', () => {
  // Rules that only exist to move things: keyframes, :active presses, the menu chevron.
  const moving = [
    ...(theme.match(/@keyframes[\s\S]*?\n\}\n/g) || []),
    ...(HabitatLayout.CSS.match(/@keyframes[\s\S]*?\n\}\n/g) || []),
    ...(theme.match(/[^{}]*:active\s*\{[^}]*\}/g) || []),
    ...(HabitatLayout.CSS.match(/[^{}]*:active\s*\{[^}]*\}/g) || []),
    ...(HabitatLayout.CSS.match(/[^{}]*aria-expanded="true"[^{}]*\{[^}]*\}/g) || [])
  ];
  assert.ok(moving.length >= 6);
  for (const rule of moving) assert.doesNotMatch(rule, /(^|[\s;{])transform\s*:/, rule.trim().slice(0, 80));
});

test('windows, pickers, menus and the voice bar arrive instead of blinking in', () => {
  const animated = (selector) => new RegExp(
    selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[^{}]*\\{[^}]*animation:\\s*hb-(fade|rise|drop|pop)'
  );
  for (const selector of ['.modal-overlay > .modal', '.reply-bar', '.mobile-server-menu', '.haven-tooltip']) {
    assert.match(theme, animated(selector), `${selector} has no entrance`);
  }
  for (const selector of ['.emoji-picker', '.user-context-menu', '.msg-toolbar', '.voice-bar']) {
    assert.ok(new RegExp(selector.replace('.', '\\.') + '[\\s\\S]{0,900}?animation:\\s*hb-').test(theme), `${selector} has no entrance`);
  }
  assert.match(HabitatLayout.CSS, /\[data-habitat-menu\]:not\(\[hidden\]\)\s*\{[^}]*animation:\s*habitat-layout-drop/);
  assert.match(HabitatLayout.CSS, /\[data-habitat-dialog-panel\]\s*\{[^}]*animation:\s*habitat-layout-pop/);
});

test('entrances are short: nothing makes a member wait for the interface', () => {
  const tokens = { '--hb-fast': 0.12, '--hb-base': 0.18 };
  for (const [name, seconds] of Object.entries(tokens)) {
    assert.match(theme, new RegExp(`${name}:\\s*${String(seconds).replace('0.', '\\.')}s`), `${name} changed`);
  }
  const durations = [
    ...[...theme.matchAll(/animation:\s*hb-[\w-]+\s+([\d.]+)s/g)].map((hit) => Number(hit[1])),
    ...[...HabitatLayout.CSS.matchAll(/animation:\s*habitat-layout-[\w-]+\s+([\d.]+)s/g)].map((hit) => Number(hit[1]))
  ];
  assert.ok(durations.length >= 4);
  for (const seconds of durations) assert.ok(seconds <= 0.25, `an entrance takes ${seconds}s`);
  assert.doesNotMatch(theme + HabitatLayout.CSS, /animation:[^;]*infinite/, 'nothing moves on its own');
});

test('reduced motion is left to Haven\'s own switch in the app, and follows the system on the login page', () => {
  // The switch this relies on: it must still zero every animation and transition.
  assert.match(accessibility, /html\.reduce-motion \*[\s\S]{0,200}animation-duration:\s*0\.001ms !important/);
  assert.match(accessibility, /transition-duration:\s*0\.001ms !important/);
  const media = theme.match(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}\n/g) || [];
  assert.equal(media.length, 1);
  assert.match(media[0], /\[data-haven-page="auth"\]/);
  assert.doesNotMatch(media[0], /data-haven-page="app"|html\[data-haven-theme-api/,
    'forcing it in the app would override a member who set the switch to off');
  assert.doesNotMatch(HabitatLayout.CSS, /prefers-reduced-motion/);
});

test('the mark beside a server grows with the pointer and the selection', () => {
  const base = theme.match(/\.server-icon:not\(\.add-server\)[^{}]*::before\s*\{[^}]*\}/)?.[0] || '';
  assert.match(base, /height:\s*2\.25rem;/);
  assert.match(base, /scale:\s*1 0;/);
  assert.match(base, /transition:\s*scale/);
  assert.match(base, /clip-path:\s*polygon/, 'it carries the Habitat cut');
  assert.match(theme, /\.server-icon:not\([^{}]*:hover::before\s*\{\s*scale:\s*1 \.556/);
  assert.match(theme, /\.server-icon\.active:not\([^{}]*::before\s*\{\s*scale:\s*1 1/);
});
