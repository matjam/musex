# musex

A Spotify-style desktop music player (macOS and Linux) for your own Plex
library.

musex streams directly from your Plex Media Server and plays the **original
files** — every codec Plex can store (FLAC, ALAC, Opus, MP3, …) is decoded by
mpv, so nothing is ever transcoded. On top of that it builds
a listening profile from what you actually play, and turns it into smart
playlists, mood mixes, radio, and recommendations.

<img width="1392" height="932" alt="image" src="https://github.com/user-attachments/assets/95c64b08-5e9d-4845-aac1-62db37fbe6b5" />

<!-- ![musex](docs/screenshot.png) -->

## Features

- **Direct play, every codec, gapless** — audio is decoded by mpv, not the
  browser. No transcoding, no quality loss, gapless album playback.
- **Volume leveling & EQ** — optional ReplayGain or real-time loudness
  leveling, plus EQ presets (Bass Boost, Vocal, Loudness, …) applied in the
  audio engine, not the UI.
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
  - **Acquisition plugins** (e.g. Lidarr) — see an external artist's full
    discography, add albums (or monitor a whole artist) for download, and
    watch request status — turning "I wish I had this" into "it's in my
    library." Install acquisition plugins (e.g. Lidarr) from a plugin repo
    via **Settings → Plugins → Add from GitHub**.
  - Federated search: results show what you own next to what you could
    acquire.
  - The plugin API is deliberately source-agnostic: a plugin that can look up
    an artist's albums and fetch one (an online music store like Bandcamp, a
    different download manager, anything) plugs into the same search,
    downloads, and taste-expansion machinery with no app changes.
    See [docs/plugins.md](docs/plugins.md).
- **Auto-update** — checks GitHub Releases silently and updates in place on
  macOS and the Linux AppImage; `.deb`/package installs update through your
  package manager.

## Install

Grab the latest build from [Releases](https://github.com/matjam/musex/releases):

- **macOS** (Apple Silicon): `musex-x.y.z-arm64.dmg` — signed and notarized.
- **Linux** (x64): `musex-x.y.z-x86_64.AppImage` (`chmod +x` and run;
  auto-updates) or `musex_x.y.z_amd64.deb` (`sudo apt install ./musex_*.deb`).
  **Linux requires `mpv`** — the `.deb` installs it automatically; AppImage
  users install it with their package manager (`sudo apt install mpv`, or
  dnf/pacman). musex shows a reminder if mpv is missing.
- **Arch Linux:** each release attaches a ready-pinned `-bin` `PKGBUILD` —
  `curl -LO https://github.com/matjam/musex/releases/latest/download/PKGBUILD &&
  makepkg -si` (repackages the AppImage; pulls `mpv`). See
  [`packaging/arch`](packaging/arch/).

You'll need a [Plex Media Server](https://www.plex.tv/) with a music library.
On first launch musex signs you in via plex.tv (PIN flow) and stores the token
in the OS keychain (macOS Keychain / libsecret or kwallet on Linux; if no
keyring is available the token is stored unencrypted with a warning).

The last.fm plugin is bundled. Acquisition plugins (e.g. Lidarr) are installed
from a plugin repo via Settings → Plugins → Add from GitHub.

## Development

Requires Node 24 (the version CI uses) and [pnpm](https://pnpm.io/) 11.

```sh
pnpm install
pnpm vendor          # fetch the pinned mpv build (macOS; no-op on Linux)
pnpm dev             # run the app with hot reload
pnpm check           # lint + typecheck + format + tests (the CI bar)
```

On Linux, mpv is a **system dependency** rather than bundled, so `pnpm vendor`
is a no-op there — install mpv from your package manager before `pnpm dev`.

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
roll up into a release PR, and merging it builds and publishes the macOS DMG
(signed + notarized) alongside the Linux AppImage and `.deb`.

## License

[MIT](LICENSE). The macOS app bundles an unmodified
[mpv](https://mpv.io/) binary (GPL-2.0-or-later) as a separate process for
audio playback; mpv's source is available at
[mpv-player/mpv](https://github.com/mpv-player/mpv), and the exact build we
ship is fetched by [`scripts/fetch-mpv.mjs`](scripts/fetch-mpv.mjs). On Linux
mpv is the system package, not bundled. Full dependency attribution is in the
app's About window.
