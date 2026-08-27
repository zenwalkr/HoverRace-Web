# HoverRace Web

HoverRace Web is an HTML5/WebGL port of the classic HoverRace racing game.
It combines the original HoverRace source and assets with a browser client,
PHP multiplayer services, custom-track tools, and deterministic procedural
track generation.

## Features

- WebGL racing with desktop keyboard and multitouch controls.
- Responsive 16:9 presentation optimized for desktop and iPhone Safari.
- Native-style 5 ms physics, steering, jumping, collisions, laps, weapons,
  powerups, hazards, checkpoints, and finish results.
- Internet Room lobby with general chat, waiting games, synchronized countdowns,
  host-controlled starts, and private in-race chat.
- PHP multiplayer backend suitable for ordinary nginx with PHP-FPM.
- Built-in ClassicH, Steeplechase, The Alley2, and The River tracks.
- Imported `.json` and `.trk` tracks.
- Deterministic organic procedural tracks in Small, Medium, and Large sizes,
  with numeric seeds and JSON/TRK export.
- Original HoverRace source and reference assets in `HoverRace-master/`.

## Quick start

```sh
cd hr-web
npm install
npm run assets
npm run dev
```

The asset conversion step requires `ffmpeg`. Run the physics and server tests
with:

```sh
npm run test:physics
npm run test:server
```

Create a production client with:

```sh
npm run build
```

The generated browser files are written to `hr-web/dist/`. Generated build
files, dependencies, test results, server runtime data, and backup archives
are intentionally excluded from Git.

## nginx/PHP deployment

Deploy `hr-web/dist/` as the document root, and keep the project-level
`hr-web/api.php` and `hr-web/server/` alongside it. The direct `api.php` wrapper
uses query routing, so standard nginx PHP-FPM handling is sufficient; no API
rewrite or catch-all front-controller rule is required.

The server stores room, lobby, chat, and race state under `hr-web/server/var/`.
That directory must be persistent and writable by the PHP-FPM user. A
permission failure there can make the browser report `SERVER OFFLINE` even when
PHP itself is reachable.

The browser bundle uses app-relative URLs and can be installed at the domain
root or below a path such as `/games/hoverrace/`. Browser source changes require
`npm run build`; PHP-only changes require redeploying `api.php` or `server/`.

## Multiplayer

Internet Room is a shared lobby. Players appear in general chat until they
create or join a waiting game. Only the host can start a game. Starting assigns
one future `startAt` timestamp to every racer and removes the game and its
players from the lobby. Custom and procedural track data is sent to joining
players before the synchronized countdown.

## Tracks

Use the main-menu track selector to choose built-in tracks, procedural engines,
or imported tracks. Procedural engines reveal a numeric seed field. The same
seed produces the same circuit and can be exported as port JSON or a native
reader-compatible `.trk` file for solo or multiplayer use.

## Repository layout

```text
HoverRace-master/   Original HoverRace source and assets
hr-web/src/         Browser game, renderer, input, network, and physics code
hr-web/public/      Converted game assets and built-in tracks
hr-web/server/      PHP multiplayer service
hr-web/tests/       Physics, server, procedural, production, and visual tests
hr-web/api.php      Direct PHP API wrapper
```

See [`hr-web/README.md`](hr-web/README.md) for detailed implementation,
deployment, performance, and troubleshooting notes.

## License

This project includes and derives from HoverRace source and assets. Review the
repository [`NOTICE.md`](NOTICE.md) and the complete
[`hr-web/HOVERRACE-LICENSE.txt`](hr-web/HOVERRACE-LICENSE.txt) before
redistributing or hosting it. The public/browser distribution also carries
these notices under `hr-web/public/` so they are included in `dist/` after a
production build.
