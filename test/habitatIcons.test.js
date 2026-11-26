'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const HavenGlyphs = require('../plugins/HavenGlyphs.plugin.js');
const icons = require('../scripts/habitat-icons.js');
const { parseThemeMetadata } = require('../src/themeMetadata');

const ROOT = path.join(__dirname, '..');

function themeSource(file) {
  return fs.readFileSync(path.join(ROOT, 'themes', file), 'utf8');
}

test('every Habitat icon override targets a class Haven Glyphs really draws', () => {
  for (const [glyphClass, name] of Object.entries(icons.GLYPHS)) {
    assert.ok(HavenGlyphs.ICON_CODEPOINTS[glyphClass], `${glyphClass} is not a Haven Glyphs class`);
    assert.ok(icons.ICONS[name], `${glyphClass} points at a missing icon: ${name}`);
  }
});

test('Habitat icons are plain stroke paths that survive a CSS data URI', () => {
  for (const [name, spec] of Object.entries(icons.ICONS)) {
    for (const d of [].concat(spec)) {
      assert.match(d, /^[MmLlHhVvAaCcSsZz0-9 .\-]+$/, `${name} has characters outside path data`);
    }
    const svg = icons.svg(name);
    assert.doesNotMatch(svg, /["#]/, `${name} would break out of the url("...") value`);
    assert.match(svg, /stroke-width='1\.75'/);
    assert.match(svg, /viewBox='0 0 24 24'/);
  }
});

test('the interface icons people see most are drawn by Habitat', () => {
  const expected = {
    'fa-gear': 'gear', 'fa-microphone': 'mic', 'fa-volume-high': 'voice',
    'fa-users': 'members', 'fa-lock': 'lock', 'fa-magnifying-glass': 'search',
    'fa-thumbtack': 'pin', 'fa-bell': 'bell', 'fa-trash-can': 'trash'
  };
  for (const [glyphClass, name] of Object.entries(expected)) {
    assert.equal(icons.GLYPHS[glyphClass], name);
  }
});

test('each Habitat theme carries the current generated icon block', () => {
  for (const file of icons.THEMES) {
    const css = themeSource(file);
    const from = css.indexOf(icons.START);
    const to = css.indexOf(icons.END);
    assert.ok(from !== -1 && to > from, `${file} has no icon markers`);
    assert.equal(
      css.slice(from, to + icons.END.length),
      icons.block(),
      `${file} is stale: run node scripts/habitat-icons.js`
    );
    assert.doesNotMatch(css, /https?:\/\/(?!www\.w3\.org\/2000\/svg)/i, `${file} loads something remote`);
  }
});

test('Habitat Grafit is a compatible palette theme with readable accent ink', () => {
  const css = themeSource('habitat-grafit.theme.css');
  const meta = parseThemeMetadata(css);
  assert.equal(meta.name, 'Habitat Grafit');
  assert.equal(meta.compatible, true);
  assert.equal(meta.palette, true);

  const token = (name) => css.match(new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, 'i'))?.[1];
  const luminance = (hex) => {
    const channel = (i) => {
      const v = parseInt(hex.slice(i, i + 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  };
  const contrast = (a, b) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  const pairs = [
    ['--accent-text', '--accent'], ['--danger-text', '--danger'], ['--warning-text', '--warning'],
    ['--text-primary', '--bg-primary'], ['--text-secondary', '--bg-secondary'],
    ['--text-muted', '--bg-primary'], ['--text-muted', '--bg-secondary'], ['--text-link', '--bg-primary']
  ];
  for (const [fg, bg] of pairs) {
    const ratio = contrast(token(fg), token(bg));
    assert.ok(ratio >= 4.5, `${fg} on ${bg} is ${ratio.toFixed(2)}:1, below 4.5:1`);
  }
});

test('Habitat Grafit ships every font it names, with the licenses beside them', () => {
  const css = themeSource('habitat-grafit.theme.css');
  const fontDir = path.join(ROOT, 'themes', 'habitat-fonts');
  const faces = [...css.matchAll(/@font-face\s*\{[^}]*\}/g)].map((hit) => hit[0]);
  assert.equal(faces.length, 4, 'two families, each as latin and latin-ext');
  for (const face of faces) {
    const file = face.match(/src:\s*url\("habitat-fonts\/([\w.-]+\.woff2)"\)\s*format\("woff2"\)/)?.[1];
    assert.ok(file, 'a font face loads a woff2 file from the folder beside the theme');
    assert.ok(fs.statSync(path.join(fontDir, file)).size > 1000, `${file} is missing or empty`);
    assert.match(face, /font-display:\s*swap/);
    assert.match(face, /unicode-range:/);
  }
  // Turkish needs ğ, ş and İ (latin-ext) as well as ı, which sits in the latin file.
  assert.ok(faces.some((face) => /figtree-latin-ext/.test(face) && /U\+0100-02BA/.test(face)));
  assert.ok(faces.some((face) => /figtree-latin\.woff2/.test(face) && /U\+0131/.test(face)));
  for (const family of ['Figtree', 'Bricolage Grotesque']) {
    assert.match(css, new RegExp(`--font-(main|heading):\\s*"?${family}"?,`), `${family} leads a font token`);
    assert.match(fs.readFileSync(path.join(fontDir, 'NOTICE.txt'), 'utf8'), new RegExp(family));
  }
  for (const license of ['OFL-Figtree.txt', 'OFL-BricolageGrotesque.txt']) {
    assert.match(fs.readFileSync(path.join(fontDir, license), 'utf8'), /SIL Open Font License, Version 1\.1/);
  }
});

test('every built-in profile badge has Habitat artwork that stays readable', () => {
  const { BUILTIN_ICONS } = require('../src/badges');
  assert.deepEqual(Object.keys(icons.BADGES).sort(), [...BUILTIN_ICONS].sort(),
    'a built-in badge without Habitat artwork would keep the purple disc beside the new tiles');
  const css = themeSource('habitat-grafit.theme.css');
  const luminance = (hex) => {
    const channel = (i) => {
      const v = parseInt(hex.slice(i, i + 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
  };
  for (const [name, [tile, ink, glyph]] of Object.entries(icons.BADGES)) {
    assert.match(glyph, /^[MmLlHhVvAaCcSsZz0-9 .\-]+$/, `${name} has characters outside path data`);
    const [hi, lo] = [luminance(tile), luminance(ink)].sort((a, b) => b - a);
    assert.ok((hi + 0.05) / (lo + 0.05) >= 4.5, `${name}: the glyph does not stand out from its tile`);
    assert.doesNotMatch(icons.badgeSvg(name), /"/, `${name} would break out of the url("...") value`);
    assert.ok(css.includes(`img.badge-icon[src$="/img/badges/${name}.svg"] { content: var(--hb-badge-${name}); }`),
      `${name} is not swapped in by the theme`);
  }
  // The tiles all differ, so two badges are never told apart by glyph alone.
  assert.equal(new Set(Object.values(icons.BADGES).map(([tile]) => tile)).size, Object.keys(icons.BADGES).length);
});

test('a member profile theme still paints its own card under Habitat Grafit', () => {
  const css = themeSource('habitat-grafit.theme.css');
  const surface = css.match(/\.profile-popup[^{]*\{[^}]*background:\s*var\(--bg-card\)[^}]*\}/g) || [];
  assert.ok(surface.length > 0, 'the card gets a solid surface');
  for (const rule of surface) {
    assert.match(rule, /\.profile-popup:not\(\.has-profile-theme\)/, 'the solid surface must stand aside for a profile theme');
  }
  assert.doesNotMatch(css, /--profile-banner-height/, 'the banner height belongs to the app: a picture banner needs its own');
});

test('the manager titles and tools that Haven Glyphs used to skip are named for it', () => {
  for (const selector of ['#emoji-modal .modal > h3', '#sticker-modal .modal > h3', '#sticker-modal label.btn-sm', '.sound-volume']) {
    assert.ok(HavenGlyphs.ICON_EXPLICIT_SELECTOR.split(',').includes(selector), `${selector} is not an explicit icon host`);
  }
  // The managers as a whole stay excluded, so uploaded emojis are left alone.
  assert.match(HavenGlyphs.ICON_EXCLUSION_SELECTOR, /#emoji-modal, #sticker-modal/);
  assert.deepEqual(HavenGlyphs.ICON_MAP['🔀'], ['fa-shuffle']);
  assert.deepEqual(HavenGlyphs.ICON_MAP['🔉'], ['fa-volume-low']);
  for (const glyphClass of ['fa-shuffle', 'fa-volume-low', 'fa-box']) {
    assert.ok(HavenGlyphs.ICON_CODEPOINTS[glyphClass], `${glyphClass} has no Font Awesome fallback`);
    assert.ok(icons.GLYPHS[glyphClass], `${glyphClass} has no Habitat drawing`);
  }
});
