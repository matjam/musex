# Shared-Logic Promotion to `@musex/core` — Design

**Date:** 2026-06-17
**Status:** Approved
**Context:** Pre-work for the mobile → desktop feature-parity effort. Before building mobile UI that mirrors desktop features, any pure, platform-agnostic logic that currently lives only in an app package (desktop renderer or mobile) must be promoted into the shared `@musex/core` package, so both surfaces consume one tested implementation instead of duplicating it.

## Goal

Move five units of pure logic into `@musex/core` and repoint their consumers, with **zero behavior change**, so the mobile parity work can import shared logic rather than reimplement it.

## Background

A core-promotion audit of both apps found:

- Mobile's architecture is already clean — it imports core correctly and does **not** reimplement core logic.
- The genuinely-shared-but-mislayered logic is a short list. Most other "promote" candidates are tied to a specific later phase and should move *with* that feature, not now.

This spec covers only the feature-agnostic promotions that the first mobile parity work (search, ratings, genres/mood-mix UI, playlist/queue actions) will lean on, plus two tidy-up moves of pure logic currently sitting in the wrong layer.

## Scope — what moves

| Unit | Today | → Core | Notes |
|---|---|---|---|
| `format.ts` — `formatDuration`, `relativeTime`, `formatBytes` | `packages/desktop/src/renderer/src/util/format.ts` | `packages/core/src/logic/format.ts` | Zero imports — clean drop. |
| `group-tracks-by-album.ts` — `groupTracksByAlbum`, `TrackAlbumGroup` | `packages/desktop/src/renderer/src/util/group-tracks-by-album.ts` | `packages/core/src/logic/group-tracks-by-album.ts` | Imports `Track` type. |
| `az-index.ts` — `letterFor`, `buildLetterIndex` | `packages/mobile/src/logic/az-index.ts` | `packages/core/src/logic/az-index.ts` | Zero imports — clean drop. |
| `recentlyPlayedTracks` (one function, split out) | `packages/mobile/src/logic/home-data.ts` | `packages/core/src/logic/recently-played.ts` | Imports `Track` + `smartTrackKey`. |
| `LOVED_RATING = 8` | private const in `packages/core/src/logic/smart-playlists.ts` | same file, exported | Add `export`; already re-exported via barrel. |

## Scope — what stays put (deliberate)

- **`buildForYouInput`** remains in mobile `src/logic/home-data.ts`. It bakes in mobile's seeds-only `similarOwned: []` — a mobile composition detail, not shared logic. After `recentlyPlayedTracks` is removed, `home-data.ts` keeps `buildForYouInput` only.
- **`audio-filters.ts`** is NOT promoted. `buildAf` emits an mpv `lavfi=[…]` graph string, which iOS AVPlayer cannot consume. Revisit only if iOS gains an AVAudioEngine-based EQ.
- **`art-url.ts`** (mobile) stays a mobile adapter: it embeds the Plex token directly in the URL, which desktop deliberately never does (desktop uses a proxy with a per-launch secret). Token-embedding is a platform security choice.
- **`stream-ref.ts`** (mobile AVPlayer codec decision), **`plex-parse.ts`** / **`plex-headers.ts`** (mobile raw-JSON Plex adapter) — genuine platform adapters.

## Deferred to their owning phase (not this spec)

- **Last.fm protocol** (`signing.ts` + `client.ts` → `core/logic/lastfm-protocol.ts` + a host-injected `Hasher` port) — extracted as the first task of the mobile last.fm phase, alongside its mobile adapter. No consumer exists yet, so moving it now would be premature.
- **`downloaded-records.ts` / `downloaded-set.ts`** → core — move as part of the mobile offline/downloads phase, when mobile actually has downloads.

## Approach

**Hard-move**, not re-export shims:

1. Create the module in `packages/core/src/logic/`.
2. Add it to the core barrel (`packages/core/src/index.ts`).
3. Repoint every consumer to import from `@musex/core`.
4. Delete the original file.
5. Move its test into core alongside the module (core is the project's primary test target).

No `export * from "@musex/core"` stubs left behind — they would add dead indirection that contradicts the project's explicit-over-implicit bias.

## Correctness rule: core must not import its own barrel

`@musex/core` modules import each other by **relative path**, never via `@musex/core`. So on the way in:

- `group-tracks-by-album.ts`: `import type { Track } from "@musex/core"` → `import type { Track } from "../models/index"`.
- `recently-played.ts`: `import { smartTrackKey } from "@musex/core"` → `import { smartTrackKey } from "./smart-playlists"`; `Track` from `"../models/index"`.
- `format.ts`, `az-index.ts`: no imports — move unchanged.

Core uses `verbatimModuleSyntax`, so type-only imports use `import type` (already the case in the source).

## Consumers to repoint

- **`format`** → 5 desktop files: `NowPlayingBar.tsx`, `TrackRow.tsx`, `discovery/EntityPanel.tsx`, `views/SettingsView.tsx`, `views/OnDeviceView.tsx`. Change `../util/format` (relative) → `@musex/core`.
- **`group-tracks-by-album`** → desktop `views/OnDeviceView.tsx`. Change relative import → `@musex/core`.
- **`az-index`** → mobile `app/(tabs)/library/index.tsx`. Change `../../../src/logic/az-index` (relative) → `@musex/core`.
- **`recentlyPlayedTracks`** → mobile `app/(tabs)/home/index.tsx`, `app/(tabs)/home/mix.tsx`. Import from `@musex/core`. `buildForYouInput` still imports from the local `home-data` module.

## Testing

- Each module's existing test moves into core alongside it, behavior unchanged so it stays green:
  - `format.test.ts` → `packages/core/src/logic/format.test.ts`
  - `group-tracks-by-album.test.ts` → `packages/core/src/logic/group-tracks-by-album.test.ts`
  - `az-index.test.ts` → `packages/core/src/logic/az-index.test.ts`
  - The `recentlyPlayedTracks` cases carved out of mobile `home-data.test.ts` → new `packages/core/src/logic/recently-played.test.ts`. Mobile `home-data.test.ts` keeps the `buildForYouInput` cases.
- Add a one-line assertion for the newly-exported `LOVED_RATING` (value is `8`) in `smart-playlists` tests, or assert it via the barrel — enough to lock the public export.

## Verification

Gate every commit on the full `pnpm check` (core + mobile + both desktop `tsc` passes + `biome check` + all package tests) — the project's local-bar-equals-CI-bar rule. A subagent's self-reported pass is re-verified by the controller running `pnpm check` before push.

## Out of scope / non-goals

- No new features, no UI changes, no behavior changes.
- No mobile parity features yet — this only relocates shared logic so those features can build on it.
- No last.fm or downloads promotion (deferred above).

## Success criteria

- The five units live in `@musex/core` and are exported from the barrel; `LOVED_RATING` is public.
- All consumers import the shared versions; the original desktop `util/format.ts`, `util/group-tracks-by-album.ts`, and mobile `logic/az-index.ts` files are gone; mobile `home-data.ts` retains only `buildForYouInput`.
- Tests live in core and pass; `pnpm check` is green across all packages.
- No remaining duplicate or shim of the moved logic in any app package.
