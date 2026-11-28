const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('a screen share asks the browser to leave this tab\'s own sound out', () => {
  const voice = read('public/js/voice.js');
  const start = voice.indexOf("displayMediaOptions.monitorTypeSurfaces = 'include';");
  const block = voice.slice(start, voice.indexOf('getDisplayMedia(displayMediaOptions)', start));
  assert.match(block, /getSupportedConstraints\?\.\(\)\.restrictOwnAudio/);
  assert.match(block, /restrictOwnAudio: true/);
  // The raw-audio choice made above is kept, not replaced.
  assert.match(block, /\.\.\.\(displayMediaOptions\.audio === true \? \{\} : displayMediaOptions\.audio\)/);
});

test('the account avatar shows one dot while the connection is fine', () => {
  const theme = read('themes/habitat-grafit.theme.css');
  assert.match(theme, /\.user-bar-avatar > #connection-led\.on \{ opacity: 0; \}/);
  assert.doesNotMatch(theme, /#connection-led(?!\.on)[^{]*\{[^}]*(opacity: 0|display: none)/);
});

test('stage tile marks are full size and set in from the corner', () => {
  const theme = read('themes/habitat-grafit.theme.css');
  assert.match(theme, /\[data-habitat-call-stage\] \.voice-user-menu-btn \{\s*position: absolute; inset: 1\.75rem \.75rem auto auto; width: 2rem; height: 2rem;/);
  assert.match(theme, /:not\(\[data-habitat-on-camera\]\) \.voice-status-icon \{ font-size: var\(--hb-text-lg\); \}/);
});

test('a shared video can be resized and audio players keep their own height', () => {
  const plugin = read('plugins/HabitatLayout.plugin.js');
  assert.match(plugin, /_buildMusicResize\(\) \{/);
  assert.match(plugin, /this\._inlineRestores\.push\(\[panel, property,/);
  assert.match(plugin, /\[data-habitat-music-resize\] \{ display: none; \}/);
  assert.match(plugin, /#music-embed-container:has\(iframe\[src\*="youtu"\]\) \{\s*height: var\(--hb-music-height, min\(22\.5rem, 56\.25vw\)\); max-height: 70vh;/);
});
