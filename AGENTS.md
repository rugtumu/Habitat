# Working on Habitat

Habitat is a fork of [Haven](https://github.com/ancsemi/Haven), a self-hosted
chat and voice server (Node.js, Express, Socket.IO, SQLite; the client is plain
JavaScript with no build step). Upstream moves fast, so the fork stays small.

## Rules of the fork

- **Prefer a theme or a plugin over a core edit.** Habitat's look lives in
  `themes/habitat-grafit.theme.css` and `plugins/HabitatLayout.plugin.js`.
  Read `docs/theme-authoring.md` before touching either.
- A core edit (anything under `public/js`, `src`, `server.js`) must be small and
  carry a `// Habitat fork:` comment saying why. Locale files keep "Haven"; the
  name is swapped at load time in `public/js/i18n.js`.
- Do not add dependencies, and do not touch the Dockerfile or compose files,
  without being asked.
- Comments explain why, in plain sentences. Commit messages are one imperative
  line, then a short body.

The channel header omits the Android and desktop app download buttons. The
welcome queue skips the Android promotion because its modal is absent from
the page. The desktop welcome popup still follows the member's preference.

## Where things are

| What | Where |
|---|---|
| Theme: tokens, polish, motion, phone fixes | `themes/habitat-grafit.theme.css` |
| Icon and badge drawings (source) | `scripts/habitat-icons.js` |
| Layout: sidebar, menus, add channel dialog, call buttons, call stage, voice list profiles, connection details | `plugins/HabitatLayout.plugin.js` |
| Emoji to icon swap (upstream plugin, lightly extended) | `plugins/HavenGlyphs.plugin.js` |
| Fonts and their licenses | `themes/habitat-fonts/` |
| VPS setup and how to switch the look on | `docs/examples/habitat-caddy-coturn/README.md` |
| What to do on the server after a push | `docs/examples/habitat-caddy-coturn/UPDATING.md` |

The icon block at the end of the theme is generated. After changing an icon or
badge run `node scripts/habitat-icons.js`; never edit between the
`HABITAT-ICONS` markers by hand.

## Theme and layout conventions

- Sizes in `rem`. Colours through the tokens at the top of the theme.
- Motion animates `opacity`, `translate`, `scale` or `rotate` only, never
  `transform`, never longer than 0.25s, nothing looping. Reduced motion is left
  to Haven's own `html.reduce-motion` switch.
- A member's own profile theme (`.has-profile-theme`) and banner header mode
  are their choice: surface rules must stand aside for them.
- The layout only moves whole `data-haven-region` elements and a few named
  buttons, records where each came from, and must restore the page exactly.
  Nothing may be hidden unless it stays reachable somewhere else.
- It has two shapes: `desktop` (901px and wider) and `compact` (below).
  Check both, and 375px wide, after any change.
- The call stage (`[data-habitat-call-stage]`, built in `_buildCallStage`)
  holds Haven's voice roster, camera panel and stream panel as they are. The
  panels dissolve with `display: contents` and each of Haven's own tiles is
  given a grid cell; tiles are never rebuilt or re-parented one by one, so
  their buttons and handlers keep working. `HabitatLayout.stageGrid` picks the
  tile size. Haven writes sizes and `display` inline on those panels, which is
  why the stage carries three `!important` rules; the layout test lists them.

## Running and testing

```bash
npm install
HAVEN_DATA_DIR=/tmp/habitat-dev PORT=3100 HOST=127.0.0.1 FORCE_HTTP=true ADMIN_USERNAME=admin node server.js
```

Register as `admin` to get an admin account. Then set the look in the browser:
theme Habitat Grafit, Settings > Layout > Habitat, Interface Icons > Glyphs.

```bash
node --test test/habitatIcons.test.js test/habitatLayout.test.js test/habitatMobile.test.js test/habitatMotion.test.js test/habitatMedia.test.js
npm test
```

The full suite takes about ten minutes. On macOS two `tunnelCloudflared` tests
and one `serverListSync` test fail without any change of ours; they pass or are
irrelevant on Linux and alone.

Unit tests do not prove the interface. Open the app and look: screenshots at
1440px and 375px, and read values back from the page rather than assuming.

## The live server

`https://habitat.umutgur.com` is in use by real people. Look, do not touch: no
messages, no channels, no saved settings, and do not open a channel that shows
an unread count (that marks it read for the account). Deploying is done by the
server's owner; the steps, checks and rollback are in
`docs/examples/habitat-caddy-coturn/UPDATING.md`.

## Open work

1. **Voice.** The Voice room template sets voice on and text and media off.
   Habitat groups these rooms in the sidebar and opens the call stage on join.
   Speaking, mute, room changes, a camera and a screen share have been checked
   with two browser accounts and generated audio and video (canvas streams in
   place of real devices). Real cameras, real screen capture, more than two
   live participants and phones still need a real call. On a phone the camera,
   share and leave buttons are in the drawer; a control bar on the stage itself
   would be the next step.
2. **Call quality.** A call is a mesh: a shared screen and a camera are sent
   once to every other person. `public/js/voice.js` now splits the screen
   share cap between the people in the call (`_screenShareOf`) and gives the
   camera a ceiling per quality (`_applyWebcamBitrate`); `test/habitatMedia.test.js`
   covers both. Still open: a viewer who closes a share keeps receiving it,
   the share is always tuned for motion rather than text, and coturn in the
   example setup has no bandwidth limit. Haven's built-in voice relay (an SFU,
   Admin > voice relay mode) sends each picture once however many people watch;
   it has not been tried on this server.
3. **Light theme.** Habitat Grafit is dark only.
4. **Native apps.** The TestFlight and Play Store apps are upstream's and
   probably do not show the Habitat theme or layout. Not started.
