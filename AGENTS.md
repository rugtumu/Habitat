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

## Where things are

| What | Where |
|---|---|
| Theme: tokens, polish, motion, phone fixes | `themes/habitat-grafit.theme.css` |
| Icon and badge drawings (source) | `scripts/habitat-icons.js` |
| Layout: sidebar, menus, add channel dialog, call buttons | `plugins/HabitatLayout.plugin.js` |
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

## Running and testing

```bash
npm install
HAVEN_DATA_DIR=/tmp/habitat-dev PORT=3100 HOST=127.0.0.1 FORCE_HTTP=true ADMIN_USERNAME=admin node server.js
```

Register as `admin` to get an admin account. Then set the look in the browser:
theme Habitat Grafit, Settings > Layout > Habitat, Interface Icons > Glyphs.

```bash
node --test test/habitatIcons.test.js test/habitatLayout.test.js test/habitatMobile.test.js test/habitatMotion.test.js
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

1. **Haven app promotions.** `public/js/modules/app-platform.js` shows an
   Android app window to every member on every load (`_runWelcomePromoQueue`),
   plus desktop and Android pills in the channel header. They advertise
   upstream's apps under Habitat's name. Removing them is a core edit and has
   not been decided yet: ask before doing it.
2. **Voice.** No separate voice channel type and no call view in the main
   area; both need core work. Camera, screen share and the speaking indicator
   have not been checked in a real call.
3. **Light theme.** Habitat Grafit is dark only.
4. **Native apps.** The TestFlight and Play Store apps are upstream's and
   probably do not show the Habitat theme or layout. Not started.
