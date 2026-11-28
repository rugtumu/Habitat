'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { CSS: layout } = require('../plugins/HabitatLayout.plugin.js');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const theme = read('themes/habitat-grafit.theme.css');
const accessibility = read('public/css/style-accessibility.css');
const page = '[data-haven-page="app"]';
const relativeSize = ':root[data-text-size]:not([data-text-size="100"])';
const comfortable = ':not([data-density="compact"])';

function rule(css, selector) {
  const start = css.indexOf(selector + ' {');
  assert.notEqual(start, -1, selector);
  return css.slice(start + selector.length + 2, css.indexOf('}', start));
}

test('Grafit draws plain channel unreads as dots and personal mentions as a count', () => {
  const dot = rule(theme, page + ' .channel-item:not(.dm-item) > .channel-badge:not([data-mentions], .channel-badge-bubble, .thread-mention-badge)');
  for (const declaration of ['font-size: 0;', 'min-width: 0;', 'padding: 0;', 'border-radius: 50%;',
    'width: .4375rem;', 'height: .4375rem;', 'background: var(--text-primary) !important;']) assert.ok(dot.includes(declaration));
  const numbers = rule(theme, [page + ' .channel-badge[data-mentions]', page + ' .dm-item > .channel-badge',
    page + ' .channel-badge-bubble'].join(',\n'));
  assert.match(numbers, /background: var\(--danger\)/);
  assert.match(numbers, /color: var\(--danger-text\)/);
  assert.doesNotMatch(numbers, /font-size: 0/);
  assert.match(rule(theme, page + ' .channel-badge[data-mentions]'), /font-size: 0;/);
  const count = rule(theme, page + ' .channel-badge[data-mentions]::after');
  assert.match(count, /content: attr\(data-mentions\)/);
  assert.match(count, /font-size: \.625rem/);
  const name = rule(theme, page + ' .channel-item:has(> .channel-badge:not(.thread-mention-badge)) .channel-name');
  assert.match(name, /font-weight: 700;/);
  assert.match(name, /color: var\(--text-primary\)/);
});

test('cozy and spacious scale from the Grafit base above every matching core text-size rule', () => {
  const content = ' :is(.message-content, .thread-msg-content)';
  const size = 'font-size: calc(var(--hb-msg-text) * var(--msg-text-scale, 1))';
  assert.match(rule(theme, ':root'), /--hb-msg-text: 1\.0625rem;/);
  assert.ok(rule(theme, 'html' + comfortable + ' ' + page + content).includes(size + ';'));
  const selector = 'html' + relativeSize + comfortable + ' ' + page + content;
  assert.ok(rule(theme, selector).includes(size + ' !important;'));
  // The theme selector has (0,6,1): :is contributes one class, as does each :not.
  // Check the class/attribute budget of each relevant core rule, including multi-class topic bodies.
  const rules = [...accessibility.matchAll(/^(:root\[data-text-size\][^{]+)\{\s*font-size:[^}]*!important/gm)];
  const matching = rules.map(m => m[1]).filter(s => /\.(?:message-content|thread-msg-content|thread-topic-body|forum-topic-snippet)\b/.test(s));
  assert.ok(matching.some(s => s.includes('[data-density="spacious"]')));
  assert.ok(matching.some(s => s.includes('.thread-panel:not(.thread-panel-forum)')));
  for (const core of matching) {
    assert.doesNotMatch(core, /#|:is\(/, core);
    assert.ok((core.match(/:root|\[|\.[\w-]+/g) || []).length <= 6, core);
    assert.doesNotMatch(core.replace(/:root|:not|\[[^\]]+\]|\.[\w-]+/g, ''), /[a-z]/i, core);
  }
  assert.equal(theme.split(size).length - 1, 2, 'both Grafit message rules exclude compact');
});

test('the scaled composer override is desktop-only and leaves compact to core', () => {
  const desktopBlocks = [...theme.matchAll(/@media \(min-width: 901px\) \{([\s\S]*?)\n\}/g)].map(m => m[1]).join('\n');
  const composer = page + ' [data-haven-region="composer"] > textarea';
  const size = 'font-size: calc(var(--hb-composer-text) * var(--msg-text-scale, 1)) !important;';
  assert.match(rule(theme, ':root'), /--hb-composer-text: 1rem;/);
  assert.match(rule(desktopBlocks, composer), /font-size: var\(--hb-composer-text\)/);
  assert.ok(rule(desktopBlocks, relativeSize + comfortable + ' ' + composer).includes(size));
  assert.equal(theme.split(size).length - 1, 1);
  assert.ok(rule(accessibility, relativeSize + ' :is(.message-input-area textarea, .edit-textarea)').includes('!important'));
});

test('the stage consumes root tokens regardless of stylesheet order, including the phone override', () => {
  const defaults = rule(layout, ':where(:root)');
  const root = rule(theme, ':root');
  const stage = rule(layout, '[data-habitat-call-stage]');
  for (const [token, fallback, grafit] of [
    ['--hb-stage-gap', '.5rem', '.625rem'], ['--hb-stage-pad', '.75rem', '.875rem'],
    ['--hb-stage-surface', 'var(--bg-tertiary)', 'radial-gradient('],
  ]) {
    assert.ok(defaults.includes(token + ': ' + fallback));
    assert.ok(root.includes(token + ': ' + grafit));
    assert.equal(layout.split(token + ':').length - 1, 1);
    assert.equal(theme.split(token + ':').length - 1, token.endsWith('surface') ? 1 : 2);
    assert.ok(stage.includes('var(' + token + ')'));
  }
  assert.match(stage, /background: var\(--hb-stage-surface\)/);
  assert.match(theme, /@media \(max-width: 768px\) \{\s*:root \{ --hb-stage-gap: \.375rem; --hb-stage-pad: \.5rem; \}/);
  assert.doesNotMatch(theme, /^\[data-habitat-call-stage\] \{/m);
});

test('app and sign-in viewports allow pinch zoom and retain their existing layout directives', () => {
  for (const file of ['public/app.html', 'public/index.html']) {
    const tags = [...read(file).matchAll(/<meta name="viewport" content="([^"]+)"/g)];
    assert.equal(tags.length, 1);
    const settings = tags[0][1].split(',').map(s => s.trim());
    assert.deepEqual(settings, ['width=device-width', 'initial-scale=1.0',
      ...(file.endsWith('/app.html') ? ['viewport-fit=cover', 'interactive-widget=resizes-content'] : [])]);
  }
});
