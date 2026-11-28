'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { colorSchemeFor } = require('../public/js/theme-compat');
const { contrast, rgb } = require('./fixtures/colorContrast');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const base = read('themes/habitat-grafit.theme.css');
const light = read('themes/habitat-grafit-light.theme.css');
const stripCommentsAndImport = css => css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^@import[^;]+;/m, '');
function roots(css) {
  return [...stripCommentsAndImport(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(match => match[1].trim() === ':root').map(match => match[2]);
}
function declarations(body) {
  return [...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(match => [match[1], match[2].trim()]);
}
const entries = declarations(roots(light)[0]);
const tokens = Object.fromEntries(entries);
const color = name => tokens['--' + name];
const media = new Set(['--hb-scrim', '--hb-media-surface', '--hb-media-plate', '--hb-media-plate-hover',
  '--hb-on-media', '--hb-on-media-fill']);

function check(fg, bg, minimum, label) {
  const ratio = contrast(fg, bg);
  assert.ok(ratio >= minimum, `${label}: ${ratio.toFixed(2)}:1, needs ${minimum}:1`);
}
function pair(fg, bg, minimum) {
  check(color(fg), color(bg), minimum, fg + ' on ' + bg);
}
function mix(a, fraction, b) {
  const from = Array.isArray(a) ? a : rgb(a);
  const to = Array.isArray(b) ? b : rgb(b);
  return from.map((c, i) => Math.round(c * fraction + to[i] * (1 - fraction)));
}
function fraction(css, rule) {
  const body = css.match(rule)?.[1];
  assert.ok(body, String(rule));
  return Number(body.match(/color-mix\(in srgb, [^;]*? (\d+)%/)[1]) / 100;
}

test('one light root covers every shared colour, including later additions to Grafit', () => {
  assert.equal(roots(light).length, 1);
  assert.equal(entries.length, Object.keys(tokens).length, 'a light token was declared twice');
  for (const root of roots(base)) {
    for (const [name, value] of declarations(root)) {
      if (media.has(name) || /^--hb-(?:icon-|badge-|face)/.test(name)) continue;
      if (/#[\da-f]{3,8}\b|rgba?\(/i.test(value)) assert.ok(tokens[name], name + ' needs a light value');
    }
  }
  for (const name of media) assert.doesNotMatch(light, new RegExp(name + '\\s*:'));
  assert.equal(color('border-color'), 'var(--border)');
  assert.equal(color('bg-card'), color('bg-primary'));
  assert.equal(colorSchemeFor(color('bg-primary')), 'light');
  assert.equal(read('public/js/theme-init.js').match(/'habitat-grafit-light\.theme\.css':\s*'(#[a-f0-9]+)'/)[1],
    color('bg-primary'));
  pair('bg-primary', 'bg-secondary', 1.08);
  pair('bg-secondary', 'hb-rail', 1.15);
  pair('hb-rail', 'hb-rail-hover', 1.10);
});

// The amber item on rail-hover is a signal mark. Elsewhere these are body-text thresholds.
const surfaces = ['bg-primary', 'bg-secondary', 'bg-tertiary', 'bg-hover', 'bg-active', 'bg-input',
  'bg-card', 'hb-rail', 'hb-rail-hover'];
for (const fg of ['text-primary', 'text-secondary', 'text-muted', 'text-link', 'accent', 'accent-hover',
  'success', 'danger', 'warning']) {
  test(fg + ' has sufficient contrast across the light palette', () => {
    for (const bg of surfaces) pair(fg, bg, fg === 'warning' && bg === 'hb-rail-hover' ? 3 : 4.5);
  });
}

test('filled controls, presence marks and the skyline keep their foregrounds legible', () => {
  for (const fill of ['accent', 'danger', 'warning', 'success']) pair(fill + '-text', fill, 4.5);
  pair('accent-text', 'accent-hover', 4.5);
  for (const bg of surfaces) pair('led-on', bg, 3);
  for (const bg of ['bg-primary', 'bg-secondary', 'hb-rail']) pair('led-off', bg, 3);
  for (const ink of ['text-primary', 'text-secondary']) pair(ink, 'hb-rail-active', 4.5);
  pair('text-primary', 'hb-sky', 4.5);
  pair('text-primary', 'hb-near-ridge', 4.5);
  pair('text-secondary', 'hb-near-ridge', 3);
});

test('mentions, reactions, hover, selection and search hits keep their contrast after mixing', () => {
  const primary = color('bg-primary');
  const accent = color('accent');
  const mention = fraction(base, /\.mention:not\(\.mention-everyone\)[^{]*\{([^}]+)/);
  const self = fraction(light, /\.mention\.mention-self\s*\{([^}]+)/);
  for (const tint of [mention, self]) check(accent, mix(accent, tint, primary), 4.5, 'mention');
  const everyone = fraction(light, /\.mention\.mention-everyone\s*\{([^}]+)/);
  check(color('warning'), mix(color('warning'), everyone, primary), 4.5, 'everyone');
  const own = fraction(base, /\.reaction-badge:is\(\.own, :hover\)\s*\{([^}]+)/);
  for (const fg of ['text-primary', 'text-secondary']) check(color(fg), mix(accent, own, primary), 4.5, 'reaction ' + fg);
  const hover = fraction(base, /#messages > :is\(\.message, \.message-compact\):hover\s*\{([^}]+)/);
  check(color('text-muted'), mix(color('bg-hover'), hover, primary), 4.5, 'hover time');
  const selection = fraction(base, /::selection\s*\{([^}]+)/);
  for (const bg of surfaces.slice(0, 4)) check(color('text-primary'), mix(accent, selection, color(bg)), 4.5, 'selection on ' + bg);
  const talking = fraction(base, /#channel-list \.channel-voice-user\.talking\s*\{([^}]+)/);
  check(color('text-primary'), mix(color('success'), talking, color('bg-secondary')), 4.5, 'talking');
  const [r, g, b, alpha] = color('accent-glow').match(/^rgba\((\d+), (\d+), (\d+), ([.\d]+)\)$/).slice(1).map(Number);
  for (const bg of ['bg-primary', 'bg-secondary']) {
    check(color('accent-hover'), mix([r, g, b], alpha, color(bg)), 4.5, 'search hit on ' + bg);
  }
});

test('the actual focus outline and a worst-case black banner remain visible', () => {
  const ink = base.match(/html\[data-haven-theme-api="1"\] :focus-visible,[^{]*\{\s*outline: [^;]* solid var\(--([\w-]+)\) !important/)[1];
  for (const bg of surfaces) pair(ink, bg, 3);
  const alpha = Number(light.match(/> \.server-banner-img[^{}]*\{\s*opacity: ([.\d]+)/)[1]);
  const banner = mix([0, 0, 0], alpha, color('bg-primary'));
  for (const fg of ['text-muted', 'text-primary', 'text-secondary', 'text-link']) check(color(fg), banner, 4.5, fg + ' over banner');
});

test('inline author ink preserves hue and contrast for all twelve palette colours and white roles', () => {
  const names = read('public/js/modules/app-utilities.js').match(/_getUserColor\(username\)\s*\{[^}]*?const colors = \[([^\]]+)\]/)[1]
    .match(/#[\da-f]{6}/gi);
  assert.equal(names.length, 12);
  assert.match(light, /-webkit-text-fill-color: color-mix\(in srgb, currentColor var\(--hb-name-weight\), var\(--text-primary\)\)/);
  assert.match(light, /background-color: color-mix\(in srgb, var\(--bg-primary\) var\(--hb-name-weight\), var\(--text-primary\)\);\s*background-blend-mode: multiply/);
  const weight = parseFloat(color('hb-name-weight')) / 100;
  for (const input of [...names, '#ffffff']) {
    const ink = mix(input, weight, color('text-primary'));
    for (const bg of surfaces.slice(0, 7)) check(ink, color(bg), 4.5, input + ' on ' + bg);
  }
});

test('hover and badge fills work independently of :has support', () => {
  const rules = [...stripCommentsAndImport(light).matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  const hover = rules.find(([_, selectors]) => selectors.includes('.donor-chip') && selectors.includes('.user-role-badge'));
  assert.doesNotMatch(hover[1], /:has\(/);
  assert.match(hover[2], /background: var\(--bg-hover\)/);
  const permission = rules.find(([_, selectors]) => selectors.trim() === '.rac-perm-item:not(.checked, :has(:checked), .disabled):hover');
  assert.match(permission[2], /background: var\(--bg-hover\)/);
});
