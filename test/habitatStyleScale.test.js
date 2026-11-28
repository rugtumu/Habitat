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
const light = fs.readFileSync(path.join(__dirname, '../themes/habitat-grafit-light.theme.css'), 'utf8');
const lightRules = declarations(light.replace(/^@import[^;]+;/m, ''));
const layoutRules = declarations(layout);
const sources = [['Grafit', grafitRules], ['layout', layoutRules], ['Grafit light', lightRules]];

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

test('Grafit Light inherits the media, type, geometry and motion scales', () => {
  for (const { property } of lightRules) {
    assert.doesNotMatch(property, /^--(?:hb-(?:scrim|media-|on-media|radius-|text-|ease|fast|base|stage-|msg-text|composer-text|channel-|member-|search-)|radius|font-|transition)/);
  }
});

const radii = new Set(['0', 'inherit', '50%', 'var(--radius-sm)', 'var(--radius)',
  'var(--hb-radius-lg)', 'var(--hb-radius-xl)', 'var(--hb-radius-pill)',
  // The phone profile sheet meets the bottom edge of the viewport.
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
      if (selector === (name === 'layout' ? ':where(:root)' : ':root')) continue;
      // Only the alpha of these black banner mask stops affects the picture.
      if (name !== 'Grafit light' && selector === banner && ['mask-image', '-webkit-mask-image'].includes(property)) {
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
const scaled = ':root[data-text-size]:not([data-text-size="100"]):not([data-density="compact"]) ';
const body = app + ':is(.message-content, .thread-msg-content)';

// Each exception belongs to a specific selector, including sizes used in font shorthands.
const sizeExceptions = new Map([
  // The personal-mention count shares Haven’s numeric channel badge.
  [app + '.channel-badge[data-mentions]::after', '.625rem'],
  // These characters draw icons, including the close button and the room introduction mark.
  [app + '.channel-voice-user .cvu-mic, ' + app + '.channel-voice-user .cvu-deafen', '.8125rem'],
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
  ['html:not([data-density="compact"]) ' + body, 'calc(var(--hb-msg-text) * var(--msg-text-scale, 1))'],
  ['html' + scaled + body, 'calc(var(--hb-msg-text) * var(--msg-text-scale, 1))'],
  [scaled + composer + ' > textarea', 'calc(var(--hb-composer-text) * var(--msg-text-scale, 1))'],
]);

// Match the entire declaration so another inset on the same surface still gets checked.
const spacingExceptions = [
  ['[data-habitat-dialog-panel]', 'padding-bottom', 'max(1rem, env(safe-area-inset-bottom))'],
  // Frames, the history illustration, crop handles and overlapping faces need clearance.
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

test('channel marks, the voice tree and DM names share one starting column', () => {
  const value = (selector, property) => grafitRules.find(r => r.selector === selector && r.property === property)?.value;
  assert.equal(value(':root', '--hb-channel-mark'), '1.25rem');
  const mark = 'var(--hb-channel-mark)';
  for (const selector of [app + '.channel-hash', '[data-habitat-rooms] .channel-item .channel-hash',
    app + '.private-channel:not(.sub-channel-item, .dm-item) > .channel-hash']) {
    assert.equal(value(selector, 'width'), mark);
    assert.equal(value(selector, 'height'), mark);
  }
  assert.equal(value(app + '.channel-item', 'height'), 'var(--hb-channel-height)');
  assert.equal(value(app + '.channel-item', 'gap'), '.5rem');
  assert.equal(value(app + '.dm-item > [data-habitat-dm-avatar]', 'margin-inline-end'), 'calc(var(--hb-channel-mark) - 1.5rem)');
  assert.equal(value(habitat + '#channel-list .channel-voice-users', 'margin'), '0 .5rem .125rem calc(.5rem + var(--hb-channel-mark) / 2)');
});

test('the composer and grouped messages share the density gutter and reserve the typing line', () => {
  const has = (selector, property, value) => assert.ok(grafitRules.some(r =>
    r.selector === selector && r.property === property && r.value === value), selector + ' ' + property);
  has('#message-area', '--msg-gutter', 'calc(var(--msg-pad-x) + var(--msg-avatar) + var(--msg-gap))');
  has('#message-area', '--hb-text-column', 'calc(var(--hb-feed-inset) + var(--msg-gutter))');
  has('#messages > .message-compact', 'padding-inline', 'var(--hb-text-column) var(--hb-feed-inset)');
  has('#messages > .message-compact.msg-selected', 'padding-bottom', 'var(--hb-followup-end, .0625rem) !important');
  has('#messages > .message-compact.msg-selected .compact-time', 'display', 'block !important');
  has('#typing-indicator', 'flex', '0 0 1rem');
  has('#message-input-area', 'grid-template-columns', 'var(--msg-gutter) minmax(0, 1fr) auto fit-content(40%) auto');
  has('#message-input-area > textarea', 'grid-column', '2');
  has('#message-input-area > textarea', 'padding', '.5rem 0');
  const cozy = 'html:not([data-density="compact"], [data-density="spacious"]) :is(#message-area, .density-sample)';
  has(cozy, '--msg-avatar', '2.5rem');
  has(cozy, '--msg-gap', '1rem');
});

test('member rows retain the avatar, optional status line and coarse target', () => {
  assert.match(theme, /--hb-member-height: 2\.5rem;/);
  assert.match(theme, /@media \(pointer: coarse\) \{\s*:root \{[^}]*--hb-channel-height: 2\.75rem;[^}]*--hb-member-height: 2\.75rem;/);
  assert.match(theme, /\[data-haven-region="member-list"\] \.user-item \{\s*height: var\(--hb-member-height\)/);
  assert.match(theme, /:is\(\.user-avatar-wrapper, \.user-item-avatar, \.user-item-avatar-img\) \{\s*width: 2rem;\s*height: 2rem;/);
  assert.match(theme, /#online-users \.user-item-sub :is\(\.user-status-text, \.user-activity\) \{ font-size: var\(--hb-text-xs\)/);
});

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
