'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { CSS: layout } = require('../plugins/HabitatLayout.plugin.js');

const theme = fs.readFileSync(path.join(__dirname, '../themes/habitat-grafit.theme.css'), 'utf8');
const tile = '[data-habitat-call-stage] :is(.voice-user-item, .webcam-tile, .screen-share-tile)';
const talking = '[data-habitat-call-stage] .voice-user-item.talking';
const inbox = '[data-haven-page="app"] [data-habitat-inbox][aria-pressed="true"]';
const banner = '[data-haven-page="app"] .main.has-banner:not(.banner-mode-shaded):not(.banner-mode-minimal):not(.banner-mode-transparent) > .server-banner-display';

// The icon generator owns the artwork between these markers. Rules after it still count.
function declarations(css) {
  const source = css.replace(/\/\* HABITAT-ICONS:START[\s\S]*?\/\* HABITAT-ICONS:END \*\//g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const result = [];
  for (const [, selector, body] of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    for (const [, property, value] of body.matchAll(/(?:^|;)\s*([\w-]+)\s*:\s*([^;]+)/g)) {
      result.push({ selector: selector.trim().replace(/\s+/g, ' '), property, value: value.trim() });
    }
  }
  return result;
}

const grafitRules = declarations(theme);
const layoutRules = declarations(layout);
const sources = [['Grafit', grafitRules], ['layout', layoutRules]];

test('the layout supplies the shared scale once with zero specificity', () => {
  const tokens = ['--radius-sm', '--radius', '--hb-radius-lg', '--hb-radius-xl', '--hb-radius-pill',
    '--hb-shadow-ink', '--hb-elev-popover', '--hb-elev-dialog', '--hb-ring-hairline', '--hb-ring-speaking',
    '--hb-scrim', '--hb-media-surface', '--hb-media-plate', '--hb-media-plate-hover', '--hb-on-media',
    '--hb-on-media-fill', '--hb-ease', '--hb-fast', '--hb-base'];
  for (const property of tokens) {
    const values = rules => rules.filter(rule => rule.property === property);
    const grafit = values(grafitRules);
    assert.equal(grafit.length, 1, property);
    assert.equal(grafit[0].selector, ':root', property);
    assert.deepEqual(values(layoutRules), [{ ...grafit[0], selector: ':where(:root)' }], property);
  }
});

const radii = new Set(['0', 'inherit', '50%', 'var(--radius-sm)', 'var(--radius)',
  'var(--hb-radius-lg)', 'var(--hb-radius-xl)', 'var(--hb-radius-pill)',
  // Joined composer controls and the phone profile sheet have square inside edges.
  'var(--hb-radius-lg) 0 0 var(--hb-radius-lg)', '0 var(--hb-radius-lg) var(--hb-radius-lg) 0',
  'var(--hb-radius-xl) var(--hb-radius-xl) 0 0']);

const shadows = new Set(['none', 'var(--hb-elev-popover)', 'var(--hb-elev-dialog)',
  'var(--hb-ring-hairline)', 'var(--hb-ring-speaking)', 'var(--hb-ring-speaking, inset 0 0 0 .125rem var(--success))']);

// These outlines convey a state or cut one avatar out of the surface behind it.
const rings = new Map([
  [tile + ':hover:where(:not(.talking))', 'inset 0 0 0 .0625rem color-mix(in srgb, var(--text-primary) 16%, transparent)'],
  ['[data-haven-page="app"] .channel-voice-user.talking::before', '0 0 0 .1875rem color-mix(in srgb, var(--success) 28%, transparent)'],
  ['[data-haven-page="app"] .profile-popup:not(.has-profile-theme) .profile-popup-avatar:is(.avatar-circle, .avatar-rounded, .avatar-squircle):not(:has(~ .pfp-border))', '0 0 0 .3125rem var(--bg-card)'],
  ['[data-habitat-stack] [data-habitat-face]', '0 0 0 .125rem var(--bg-hover)'],
]);

for (const [name, rules] of sources) {
  test(name + ' uses the corner, shadow, motion and colour scales', () => {
    for (const { selector, property, value } of rules) {
      const label = name + ' ' + selector + ' { ' + property + ': ' + value + ' }';
      if (property === 'border-radius') assert.ok(radii.has(value), label);
      if (property === 'box-shadow') assert.ok(shadows.has(value) || rings.get(selector) === value, label);
      if (['transition', 'transition-property'].includes(property) && value !== 'none') {
        for (const item of value.split(/,(?![^()]*\))/)) {
          assert.match(item.trim(), /^(?:opacity|translate|scale|rotate)(?:\s|$)/, label);
        }
      }
      if (selector === (name === 'Grafit' ? ':root' : ':where(:root)')) continue;
      // Only the alpha of these black banner mask stops affects the picture.
      if (selector === banner && ['mask-image', '-webkit-mask-image'].includes(property)) {
        assert.equal(value, 'linear-gradient(to bottom, #000 0%, #000 30%, transparent 90%)', label);
        continue;
      }
      assert.doesNotMatch(value, /#[\da-f]{3,8}\b|\brgba?\s*\(/i, label);
    }
  });
}

test('the stage and pressed Messages button keep one owner in either stylesheet order', () => {
  const all = [...layoutRules, ...grafitRules];
  function values(selector, property) {
    return all.filter(rule => rule.selector === selector && rule.property === property).map(rule => rule.value);
  }
  assert.deepEqual(values(tile, 'border-radius'), ['var(--hb-radius-lg)']);
  assert.deepEqual(values(tile, 'box-shadow'), ['var(--hb-ring-hairline)']);
  assert.deepEqual(values('[data-habitat-call-stage] :is(.webcam-tile, .screen-share-tile)', 'box-shadow'), []);
  assert.deepEqual(values(talking, 'box-shadow'), ['var(--hb-ring-speaking, inset 0 0 0 .125rem var(--success))']);
  assert.deepEqual(values(talking, 'outline'), []);
  assert.deepEqual(values(inbox, 'border-radius'), ['var(--hb-radius-lg)']);
  assert.deepEqual(values('[data-haven-page="app"] .server-icon:hover, [data-haven-page="app"] .server-icon.active', 'border-radius'),
    values(inbox, 'border-radius'));
});
