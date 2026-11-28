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

const textSizes = {
  '--hb-text-xs': '.75rem', '--hb-text-sm': '.875rem', '--hb-text-md': '1rem',
  '--hb-text-lg': '1.125rem', '--hb-text-xl': '1.5rem', '--hb-text-2xl': '2rem',
  '--hb-text-display': 'clamp(1.625rem, 3vw, 2.25rem)',
};

test('the layout supplies the shared scale once with zero specificity', () => {
  const tokens = ['--radius-sm', '--radius', '--hb-radius-lg', '--hb-radius-xl', '--hb-radius-pill',
    '--hb-shadow-ink', '--hb-elev-popover', '--hb-elev-dialog', '--hb-ring-hairline', '--hb-ring-speaking',
    '--hb-scrim', '--hb-media-surface', '--hb-media-plate', '--hb-media-plate-hover', '--hb-on-media',
    '--hb-on-media-fill', '--hb-ease', '--hb-fast', '--hb-base', ...Object.keys(textSizes)];
  for (const property of tokens) {
    const values = rules => rules.filter(rule => rule.property === property);
    const grafit = values(grafitRules);
    assert.equal(grafit.length, 1, property);
    assert.equal(grafit[0].selector, ':root', property);
    if (property in textSizes) assert.equal(grafit[0].value, textSizes[property], property);
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

const app = '[data-haven-page="app"] ';
const habitat = 'html[data-habitat-layout] ';
const stage = '[data-habitat-call-stage] ';
const composer = app + '[data-haven-region="composer"]';
const tree = habitat + '#channel-list .channel-voice-users';
const scaled = ':root[data-text-size]:not([data-text-size="100"]):not([data-density="compact"]) ';
const body = app + ':is(.message-content, .thread-msg-content)';

// Each exception belongs to a specific selector, including sizes used in font shorthands.
const sizeExceptions = new Map([
  // The personal-mention count shares Haven’s numeric channel badge.
  [app + '.channel-badge[data-mentions]::after', '.625rem'],
  // These characters draw icons, including the close button and the room introduction mark.
  [app + '.channel-voice-user .cvu-mic, ' + app + '.channel-voice-user .cvu-deafen', '.8125rem'],
  [app + '.channel-hash', '1.375rem'], [app + '.dm-item .channel-hash', '1.0625rem'],
  [app + '.welcome-icon', '2.5rem'], ['[data-habitat-intro] > span', '1.875rem'],
  [habitat + '.voice-stream-badge.live .haven-glyph', '.5rem'],
  [habitat + ':is([data-haven-region="voice-controls"], [data-haven-region="account"]) button > :is(.haven-glyph, svg), '
    + habitat + '[data-habitat-stage-controls] > button > :is(.haven-glyph, svg)', 'var(--hb-mark, 1.125rem)'],
  ['#voice-settings-panel [data-habitat-call-settings-heading] button', '1.25rem'],
  // Initials follow the diameter of their face, including the focused and responsive stage tiles.
  ['[data-habitat-face]', '.9375rem'], ['[data-habitat-call-avatar]', '1.25rem'],
  [stage + '[data-habitat-call-avatar]', 'clamp(1rem, calc(var(--hb-tile-h, 9rem) * .15), 2.25rem)'],
  [stage + '.voice-user-item[data-habitat-focused] [data-habitat-call-avatar]', '2.25rem'],
  // Conversation type follows the member's density and text-size settings.
  ['html:not([data-density="compact"]) ' + app + '.message-author', '1.0625rem'],
  ['html:not([data-density="compact"]) ' + body, 'calc(var(--hb-msg-text) * var(--msg-text-scale, 1))'],
  ['html' + scaled + body, 'calc(var(--hb-msg-text) * var(--msg-text-scale, 1))'],
  [scaled + composer + ' > textarea', 'calc(var(--hb-composer-text) * var(--msg-text-scale, 1))'],
]);

// Match the entire declaration so another inset on the same surface still gets checked.
const spacingExceptions = [
  // The channel and message rows, tree indent and composer retain their density geometry.
  [app + '.channel-item', 'padding-inline', '.625rem'], [app + '.channel-item', 'gap', '.625rem'],
  [habitat + ':where([data-haven-region="channels"] .channel-item, [data-haven-region="direct-messages"] .channel-item)', 'margin', '0.0625rem 0'],
  [tree, 'margin', '.125rem .5rem .375rem 1.25rem'], [tree, 'padding', '0 0 0 .625rem'],
  [habitat + '#channel-list .channel-voice-user', 'padding', '.125rem .375rem'],
  [app + '.message-user-sep', 'margin-block-start', '.375rem'],
  [composer, 'padding', '.25rem 1rem 1.25rem'],
  [composer, 'padding-bottom', 'max(.625rem, env(safe-area-inset-bottom))'],
  ['[data-habitat-dialog-panel]', 'padding-bottom', 'max(1rem, env(safe-area-inset-bottom))'],
  // Frames, the history illustration, crop handles and overlapping faces need clearance.
  ['[data-haven-region="message-list"] .message-row > .pfp-host', 'margin-inline', '-.1875rem .1875rem'],
  [stage + '[data-habitat-call-avatar]:has(> .pfp-border)', 'margin-block', '.5rem .625rem'],
  ['[data-habitat-stack] [data-habitat-face]', 'margin-inline-start', '-.25rem'],
  ['#border-crop-modal .border-crop-stage', 'padding', '2.5rem'],
  [app + '#messages[data-habitat-history-title]:not([data-habitat-history-title=""], .forum-view, .forum-gallery, .forum-feed):has(> .message)::before', 'padding', '3.5rem 0 .75rem'],
  // The voice status hit area expands around its original position.
  [app + '.voice-bar-status[role="button"]', 'margin', '-.25rem -.375rem'],
  [app + '.voice-bar-status[role="button"]', 'padding', '.25rem .375rem'],
  // Text clears adjacent icons, the drawer close button and the sound visibility control.
  ['#settings-modal .settings-search', 'padding-inline', '2.125rem .5rem'],
  ['[data-habitat-entry] > span + input[type="text"]', 'padding-inline-start', '2.5rem'],
  [habitat + '[data-habitat-header] > .brand', 'padding-inline-end', '4.75rem'],
  [app + '#sound-modal .soundboard-btn .sb-name', 'padding-inline-end', '1.25rem'],
  // The settings reading column and window controls share responsive insets.
  ['#settings-modal .sp-body', 'padding', '.25rem clamp(1rem, 3.5vw, 3rem) 3rem'],
  [habitat + '#settings-modal .settings-header', 'padding', '2.75rem 1rem .75rem var(--nav-inset)'],
  [habitat + '#settings-modal .settings-body', 'padding', '2.75rem 7.25rem 3rem var(--page-inset)'],
];

// Split shorthand components at the top level so spaces and division inside calculations stay intact.
function components(value) {
  const result = [];
  let part = '';
  let depth = 0;
  for (const char of value) {
    if (!depth && (/\s/.test(char) || char === '/')) {
      if (part) result.push(part);
      part = '';
      if (char === '/') result.push(char);
    } else {
      part += char;
      if (char === '(') depth++;
      if (char === ')') depth--;
    }
  }
  if (part) result.push(part);
  return result;
}

const weights = new Set(['400', '500', '600', '700']);
const sizes = new Set(['0', 'inherit', ...Object.values(textSizes).filter(size => size.endsWith('rem'))]);
const spaces = new Set(['0', 'auto', '.125rem', '.25rem', '.5rem', '.75rem', '1rem', '1.5rem', '2rem', '3rem']);

for (const [name, rules] of sources) {
  test(name + ' uses the type scale for sizes and weights, including font shorthands', () => {
    for (const { selector, property, value } of rules) {
      const label = selector + ' { ' + property + ': ' + value + ' }';
      let size = value.replace(/\s*!important$/, '');
      if (property === 'font-weight') {
        // A font-face descriptor advertises the axes in the bundled files.
        if (selector === '@font-face') assert.ok(['300 900', '200 800'].includes(size), label);
        else assert.ok(weights.has(size), label);
        continue;
      }
      if (property === 'font') {
        if (size === 'inherit') continue;
        const parts = components(size);
        if (/^\d+$/.test(parts[0]) && parts[0] !== '0') assert.ok(weights.has(parts.shift()), label);
        size = parts[0];
      } else if (property !== 'font-size') continue;
      assert.ok(sizes.has(size.replace(/^0\./, '.')) || /^var\(--[\w-]+\)$/.test(size)
        || sizeExceptions.get(selector) === size, label);
    }
  });

  test(name + ' uses the spacing scale for every padding, margin and gap component', () => {
    for (const { selector, property, value } of rules) {
      if (!/^(?:(?:padding|margin)(?:-[\w-]+)?|(?:row-|column-)?gap)$/.test(property)) continue;
      const spacing = value.replace(/\s*!important$/, '');
      if (spacingExceptions.some(([s, p, v]) => s === selector && p === property && v === spacing)) continue;
      for (const part of components(spacing)) {
        assert.ok(spaces.has(part.replace(/^0\./, '.')) || /^(?:var|calc|env)\(.+\)$/.test(part),
          selector + ' { ' + property + ': ' + value + ' }');
      }
    }
  });
}
