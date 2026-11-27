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
the page. Habitat omits the desktop promotion from the page and welcome queue.

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

- Grafit marks ordinary channel unreads with a dot and a bolder name. Personal mentions and replies show their count. DMs and collapsed groups keep numeric badges.
- The default message toolbar shows React, Reply, Edit on your own messages, and More. Quote is under More. Personal orders fill available slots.
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
- Messages on the desktop rail switches the sidebar to Haven's DM list. In
  compact it sits beside Find a conversation in the navigation sidebar. A
  second press or the server icon returns to channels. Guests see channels.
  The + at the end of the rail (in the server bubbles on phones) opens Add,
  Manage and Sync. The server name and chevron open server actions. The
  avatar and name in the account bar open Edit profile and Log out. Status
  and Settings have their own buttons there.
- The right sidebar is Members only, in both shapes. Invite Users lives in the
  server menu when Haven allows it. The voice roster stays available on the
  stage and each room lists its participants on the left. In compact the
  roster's home holds the drawer close button, and the way into a text
  channel's call (`#voice-join-mobile`) follows pins, files and threads in
  the channel menu. Topic editing lives there too, above code and move actions.
- The connected voice bar, header title and voice indicator trigger a check
  of the live call's channel. Joining the displayed voice room hides its
  introduction and gives the open stage the full conversation area.
- The call stage (`[data-habitat-call-stage]`, built in `_buildCallStage`)
  holds Haven's voice roster, camera panel and stream panel as they are. The
  panels dissolve with `display: contents` and each of Haven's own tiles is
  given a grid cell; tiles are never rebuilt or re-parented one by one, so
  their buttons and handlers keep working. `HabitatLayout.stageGrid` picks the
  tile size. Haven writes sizes and `display` inline on those panels, which is
  why the stage carries four `!important` rules; the layout test lists them.
- Haven redraws every voice row when anyone's state changes. Anything that
  should happen once per person (the join and leave effects, the avatars on
  the stage) is keyed by who is there, never by which element is new.
- The buttons on the stage (`[data-habitat-stage-controls]`) are stand-ins:
  they click the real button and copy its icon, name and state. Do not move
  the real ones there.

- A server banner larger than a 4K frame is shown, and uploaded, as a copy
  scaled down to one (`_showBanner` and `_bannerCopy` in
  `public/js/modules/app-branding.js`). Chrome decodes an oversized picture
  again on every repaint over it: a 70 megapixel banner held a live server
  to six frames a second while the page's own code sat idle.

- The page opens straight into Habitat. `public/js/theme-init.js` marks the
  root with `data-habitat-boot` before first paint when Habitat is the saved
  layout; the regions the layout moves stay out of sight until the plugin
  stamps `data-habitat-layout`, and the mark expires after three seconds so
  a failed plugin never leaves the page hidden. A returning member lands in
  the conversation they last had open on that device
  (`habitat_last_conversation_<userId>`); nothing else opens by itself,
  because opening a channel marks it read. The message list carries
  `data-history` (pending, loading, ready, start, empty, failed), and the
  conversation introduction shows only for `start` and `empty`.

## Running and testing

```bash
npm install
HAVEN_DATA_DIR=/tmp/habitat-dev PORT=3100 HOST=127.0.0.1 FORCE_HTTP=true ADMIN_USERNAME=admin node server.js
```

Register as `admin` to get an admin account. Then set the look in the browser:
theme Habitat Grafit, Settings > Layout > Habitat, Interface Icons > Glyphs.

```bash
node --test test/habitat*.test.js
npm test
```

The full suite takes about ten minutes. On macOS two `tunnelCloudflared` tests
and one `serverListSync` test fail without any change of ours; they pass or are
irrelevant on Linux and alone.

Unit tests do not prove the interface. Open the app and look: screenshots at
1440px and 375px, and read values back from the page rather than assuming.

## The live server

The live server is in use by real people; its address is kept out of this
repository. Look, do not touch: no messages, no channels, no saved settings,
and do not open a channel that shows
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
   share and leave buttons move from the drawer to a row below the open stage.
2. **Call quality.** A call is a mesh: a shared screen and a camera are sent
   once to every other person. `public/js/voice.js` gives up to three viewers
   the full screen share cap and holds the whole share to three caps beyond
   that (`_screenShareOf`) and gives the
   camera a ceiling per quality (`_applyWebcamBitrate`); `test/habitatMedia.test.js`
   covers both. On the mesh a viewer who closes a share, or has not accepted
   it, is no longer sent the picture (`updateScreenViewers`; the sender's
   encoding is switched off, never the track), and the split counts only the
   people being sent to. A sharer can tune a share for motion or for text
   (`haven_screen_hint`). Video is offered H.264 first (`_preferHardwareVideo`,
   before every offer and answer): browsers default to VP8, which they encode
   and decode in software, one encoder per viewer on the sharer's machine.
   Whether a given machine really uses its hardware for it shows in the
   connection details ("Picture you send") where the browser reports it; the
   relay (SFU) path still takes the browser's default. A share starts at a
   useful rate instead of the browser's half-megabit guess (`_videoStartSdp`
   writes `x-google-start-bitrate` into the remote description): measured
   locally at 1440p60/10 Mbps, 4 Mbps and 1080p by the third second instead
   of 3 Mbps and 540p by the sixteenth. At 60 fps a share is 1080p until the
   line gives it more than about 10 Mbps; "Text" keeps the size and drops
   frames instead. Still open: coturn in the example setup has no
   bandwidth limit. Haven's built-in voice relay (an SFU,
   Settings > Large Server Setup) sends each picture once however many people
   watch and stops sending a share to a viewer who closes it. It was tried
   locally with two accounts: the call stage and the connection details work
   through it. It is not switched on on the live server; the steps are in
   section 6 of `docs/examples/habitat-caddy-coturn/README.md`.
3. **Light theme.** Habitat Grafit is dark only.
4. **Native apps.** The TestFlight and Play Store apps are upstream's and
   probably do not show the Habitat theme or layout. Not started.
