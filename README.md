# musex

A Spotify-style macOS music player for your own Plex library.

musex streams directly from your Plex Media Server and plays the **original
files** — every codec Plex can store (FLAC, ALAC, Opus, MP3, …) is decoded by
a bundled mpv engine, so nothing is ever transcoded. On top of that it builds
a listening profile from what you actually play, and turns it into smart
playlists, mood mixes, radio, and recommendations.

<!-- screenshot: docs/screenshot.png -->
<!-- ![musex](docs/screenshot.png) -->

## Features

- **Direct play, every codec, gapless** — audio is decoded by a vendored mpv,
  not the browser. No transcoding, no quality loss, gapless album playback.
- **Your library, Spotify-shaped** — home view, artist/album/genre browsing,
  full-library search, playlists, queue, shuffle/repeat, keyboard shortcuts
  (`⌘/` shows them all).
- **Taste profile** — plays, skips, and star ratings feed an on-device
  listening profile (nothing is uploaded anywhere). It powers:
  - **Smart playlists** — Top Rated, Heavy Rotation, Rediscover, and a
    **For You** mix that resurfaces music you own but haven't played.
  - **Mood mixes** — Driving, Workout, Chill, Coding, Party, built from
    genre/mood tags and ordered by your taste.
  - **Radio** — start a station from any track or artist and musex keeps the
    queue topped up with similar music from your library.
- **Plugins** — a small, full-trust plugin system extends the app:
  - **last.fm** — scrobbling, loved tracks (synced with your star ratings),
    similar artists/tracks, listening stats.
  - **Lidarr** — see an external artist's full discography, add albums (or
    monitor a whole artist) for download, and watch request status — turning
    "I wish I had this" into "it's in my library."
  - Federated search: results show what you own next to what you could
    acquire.
  - **Bring your own source** — Lidarr is just the first acquisition
    provider. The plugin API is deliberately source-agnostic: a plugin that
    can look up an artist's albums and fetch one (an online music store like
    Bandcamp, a different download manager, anything) plugs into the same
    search, downloads, and taste-expansion machinery with no app changes.
    See [docs/plugins.md](docs/plugins.md).
- **Auto-update** — checks GitHub Releases silently and updates in place.

## Install

Grab the latest `musex-x.y.z-arm64.dmg` from
[Releases](https://github.com/matjam/musex/releases). Apple Silicon only for
now. The app is signed and notarized.

You'll need a [Plex Media Server](https://www.plex.tv/) with a music library.
On first launch musex signs you in via plex.tv (PIN flow) and stores the token
in the macOS Keychain.

The last.fm and Lidarr plugins are optional — configure them in Settings with
your own API keys.

## Development

Requires Node 24+ and [pnpm](https://pnpm.io/) 11.

```sh
pnpm install
pnpm vendor          # fetch the pinned mpv build (checksum-verified)
pnpm build:plugins   # bundle the bundled plugins (last.fm, Lidarr)
pnpm dev             # run the app with hot reload
pnpm check           # lint + typecheck + format + tests (the CI bar)
```

### Architecture

Hexagonal: a pure, platform-agnostic `@musex/core` (domain models, use-cases,
playback state machine, port interfaces — no Node, no DOM, no Electron) sits
in the middle, and every surface is an adapter over it.

In the Electron app, the **main process is the data plane**: it talks to Plex,
holds the token, proxies audio/art through a localhost server (the token never
reaches the UI), caches media and lists, and runs the mpv playback engine. The
**renderer is purely UI** — it drives playback through a typed IPC port and
plays no audio itself. Plugins run in the main process against a deliberately
narrow API (`@musex/plugin-api`) that never exposes Plex tokens or URLs; see
[docs/plugins.md](docs/plugins.md).

Releases are automated with release-please: conventional commits on `main`
roll up into a release PR, and merging it builds, signs, notarizes, and
publishes the DMG.

## License

[MIT](LICENSE). The packaged app bundles an unmodified
[mpv](https://mpv.io/) binary (GPL-2.0-or-later) as a separate process for
audio playback; mpv's source is available at
[mpv-player/mpv](https://github.com/mpv-player/mpv), and the exact build we
ship is fetched by [`scripts/fetch-mpv.mjs`](scripts/fetch-mpv.mjs). Full
dependency attribution is in the app's About window.
