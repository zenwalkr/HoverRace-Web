# HoverRace HTML5/WebGL port

This directory contains the browser port of the HoverRace source in
`../HoverRace-master`. The original source tree is treated as read-only.

## Implemented port

- Parses the original classic `.trk` record format into browser track data.
- Decodes permanent track actors, including native checkpoint/finish ordering, pickups, mines, speed zones, fuel sources, and bumper gates.
- Parses original `.msh` patch meshes, including the four craft models and game objects.
- Renders original room floors, ceilings, wall surfaces, feature geometry, and the Basic craft using WebGL.
- Ports the native per-craft 5 ms movement equations, vector momentum, steering, gravity, jump, floor/ceiling contact, and static-wall reflection.
- Runs the original checkpoint-1 → checkpoint-2 → finish lap rules and three-lap HUD state.
- Decodes the original motor, friction, jump, bump, and fire samples once into a mobile gesture-safe Web Audio layer, with automatic HTML audio fallback.
- Uses the native chase-camera distances and a 16:9 responsive viewport.
- Fits the stage to Safari's stable small viewport so address and tab bars do not clip the controls or trigger WebGL buffer reallocations.
- Interpolates the native 5 ms physics transforms at display cadence so 60 Hz mobile browsers do not expose 15/15/20 ms camera judder.
- Batches static and phase-animated track surfaces by shared material, substantially reducing WebGL/ANGLE/Metal draw submissions without lowering resolution or disabling antialiasing.
- Requests an explicitly opaque, non-premultiplied WebGL2 drawing surface so iOS Safari can present the ANGLE/Metal result without alpha-compositing the entire game canvas each frame.
- Provides keyboard and multitouch driving controls with global selection, callout, magnifier, context-menu, and drag suppression; chat text fields temporarily take priority over driving keys.
- Includes a file-locked PHP room/chat service and authenticated, expiring race-state snapshots for browser multiplayer synchronization.
- Assigns native authored starting-grid slots and synchronizes remote craft meshes, movement, motor frames, projectiles, permanent pickups, bumper-gate state, craft impacts, and weapon effects.
- Includes the original-style square track radar, nickname onboarding with numbered Guest names, general lobby chat, and private in-game race chat.
- Implements native fuel/speed zones, collectible cans and mines, item cycling, power boost, spinout, bumper gates, missiles, finish results, and restart/menu flow.
- Includes desktop and landscape-phone visual checks.
- Provides a streamlined main-menu track dropdown containing the built-in
  tracks, procedural engines, and the latest imported `.json`/`.trk` tracks.
  Selecting a procedural engine reveals its seed and generation/export tools.
- Provides deterministic procedural circuits in Small, Medium, and Large
  layouts. Entering the same numeric seed recreates the same organic closed
  spline circuit, variable-width bends, elevation changes, checkpoints,
  finish, and hazards. The current generated sizes contain 30, 48, and 64
  curved room sections respectively.
- Procedural tracks can be exported as port JSON or a native-reader-compatible
  `.trk` file, then used for solo practice or shared through multiplayer before
  the synchronized countdown.

## Development

```sh
npm install
npm run assets
npm run dev
npm run test:physics
npm run test:server
npm run test:visual
```

For a production build:

```sh
npm run build
```

The production document root is `dist/`. It contains the compiled client,
converted assets, and a direct `api.php` wrapper. The wrapper uses query
routing (`api.php?route=status`, `api.php?route=rooms`,
`api.php?route=presence`, `api.php?route=chat`,
`api.php?route=race_join`, `api.php?route=race_start`,
`api.php?route=race_leave`, and `api.php?route=race_state`) so ordinary nginx
PHP-FPM handling is sufficient; no `/api` rewrite or catch-all front-controller
rule is required. Keep the project-level `api.php` and `server/` directory
alongside `dist/` when deploying, because the wrapper loads the PHP backend
from there. Put `server/var` on persistent writable storage and make the
directory and every existing JSON file writable by the PHP-FPM user. A
permission failure there causes the browser to report `SERVER OFFLINE` even
when the PHP endpoint itself is reachable.

The Internet Room is a single lobby chat. Its directory lists active lobby
players and waiting games. Creating or joining a game removes that player from
the lobby list. Waiting games are not shown after the host starts them; the
server assigns one shared `startAt` timestamp six seconds in the future, and
joining is rejected once the game is starting or racing. Only the authenticated
host token can start a waiting game. After the start signal, the chat switches
to a token-protected room shared only by racers in that game. The HUD includes
the source-style 200×200 track radar; the in-game Leave action is available
from the pause screen.

The browser bundle uses app-relative URLs, so the `dist/` directory can be
installed at the domain root or below a subdirectory such as
`/games/hoverrace/`. PHP backend changes only require deploying the changed
`api.php` or `server/` files; browser source changes require running
`npm run build` and redeploying `dist/`.

Append `?perf=1` to the game URL to display one-second rolling frame telemetry:
FPS, 95th-percentile and maximum frame time, long/missed frames, CPU encoding
time, physics slices, WebGL draw calls and triangles, renderer identity,
canvas opacity, resize count, and drawing-buffer resolution. This is intended for diagnosing physical iOS
Safari devices where desktop emulation cannot reproduce the ANGLE/Metal path.
The panel flags a steady 30 Hz callback cadence because WebKit intentionally
limits `requestAnimationFrame` to 30 Hz when iOS Low Power Mode is enabled.

The asset conversion step requires `ffmpeg`. Generated browser assets are
written below `public/assets`.

Use the main-menu track selector's `IMPORT` button to select one or more track files.
Imported tracks are held in browser memory for the current page session and
are available for local practice. When a custom or procedural track is used
to create an Internet Room, its validated track data is stored with the
waiting game and delivered to each joining browser before the synchronized
start.

This port includes and derives from HoverRace source and assets under the
terms in `HOVERRACE-LICENSE.txt`, including its non-commercial restriction.
