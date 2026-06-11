# Audio Filters: Volume Leveling + EQ Presets — Design

**Date:** 2026-06-11
**Status:** Approved (user: "spec it and build it")

## Goal

Let the user enable volume leveling and pick an EQ preset (e.g. Bass Boost)
from Settings. Filters apply instantly to the playing audio and persist across
restarts. No custom band sliders in this iteration.

## Why this is cheap

mpv exposes the entire ffmpeg audio-filter set through its `lavfi` bridge, and
all the filters we need are compiled into our vendored build (verified against
`vendor/mpv/darwin-arm64` v0.41.0 with `--af=help`): `bass`, `treble`,
`equalizer`, `dynaudnorm`, `loudnorm`, `superequalizer`, …. Filters live on
mpv's `af` property, which is writable at runtime over the JSON IPC socket
`MpvController` already speaks — no track restart, just a brief audio-chain
reinit. ReplayGain is native (`replaygain` option/property, reads tags from
the direct-played files).

## UX

A new **Audio** section in Settings (between Local Cache and Taste Expansion),
following the existing `settings-section` / `settings-row` structure:

1. **Volume leveling** — a select with three modes:
   - **Off** (default)
   - **ReplayGain** — uses ReplayGain tags in the files (album gain, so albums
     keep their internal dynamics). Files without tags play unchanged.
   - **Auto** — `dynaudnorm` (ffmpeg Dynamic Audio Normalizer, designed for
     real-time use); works on every file, no tags needed.
   Each mode gets a one-line description under the label.

2. **Equalizer** — a select of presets:

   | id | label | ffmpeg graph fragment |
   |----|-------|----------------------|
   | `off` | Off (default) | — |
   | `bass-boost` | Bass Boost | `bass=g=6:f=110` |
   | `bass-reducer` | Bass Reducer | `bass=g=-6:f=110` |
   | `treble-boost` | Treble Boost | `treble=g=4:f=4000` |
   | `vocal` | Vocal Boost | `equalizer=f=3000:t=q:w=1:g=4` |
   | `loudness` | Loudness | `bass=g=5:f=100,treble=g=3:f=8000` |

   Gains are deliberately modest (≤6 dB) to avoid clipping; when Auto leveling
   is also on, `dynaudnorm` sits **after** the EQ in the graph, which further
   guards against clipping.

Changes apply immediately (mid-track) and persist.

## Architecture

Hexagonal as usual: all filter knowledge is pure and tested; the controller
and IPC layers only transport strings.

### 1. Pure logic — `packages/desktop/src/logic/audio-filters.ts` (new)

```ts
export type LevelingMode = "off" | "replaygain" | "auto";
export interface AudioPrefs { leveling: LevelingMode; eqPreset: string }
export const DEFAULT_AUDIO_PREFS: AudioPrefs = { leveling: "off", eqPreset: "off" };
export const EQ_PRESETS: ReadonlyArray<{ id: string; label: string; graph: string }>;

/** mpv `af` property value for these prefs ("" = no filters). */
export function buildAf(prefs: AudioPrefs): string;
/** mpv `replaygain` property value: "album" when leveling==="replaygain", else "no". */
export function replaygainMode(prefs: AudioPrefs): "album" | "no";
/** Type guard / normalizer for untrusted IPC input — unknown preset ids or
 *  leveling modes fall back to defaults rather than throwing. */
export function sanitizeAudioPrefs(raw: unknown): AudioPrefs;
```

`buildAf` composes one lavfi graph: EQ fragment first, then `dynaudnorm` if
leveling is `auto` — e.g. both on → `lavfi=[bass=g=6:f=110,dynaudnorm]`;
EQ off + auto → `lavfi=[dynaudnorm]`; everything off → `""`.
ReplayGain mode contributes nothing to the graph (it's a separate property).

### 2. Command builders — `packages/desktop/src/logic/mpv-ipc.ts` (modify)

```ts
export function cmdSetAf(id: number, af: string): MpvCommand;          // ["set_property","af",af]
export function cmdSetReplaygain(id: number, mode: "no"|"track"|"album"): MpvCommand;
```

### 3. Controller — `packages/desktop/src/main/adapters/mpv-controller.ts` (modify)

```ts
interface AudioConfig { af: string; replaygain: "no" | "track" | "album" }
async applyAudioConfig(cfg: AudioConfig): Promise<void>
```

The controller **caches the desired config** and:
- if mpv is running, sends both `set_property` commands now;
- always re-applies the cached config at the end of `doStart()` (after the
  observes), so a lazy spawn or post-crash respawn comes up with the right
  filters. Default cached config is `{af: "", replaygain: "no"}` — applying it
  on a fresh spawn is a harmless no-op-equivalent.

### 4. Persistence — `packages/desktop/src/main/adapters/persistence.ts` (modify)

`audioPrefs` key in the main `store` (same file as volume), default
`DEFAULT_AUDIO_PREFS`. `getAudioPrefs()` / `setAudioPrefs(prefs)`. Stored
values pass through `sanitizeAudioPrefs` on read (defends against hand-edited
or stale JSON).

### 5. IPC — `packages/desktop/src/shared/ipc-contract.ts`, `main/ipc.ts`, `preload/index.ts` (modify)

- Channels: `musex:audio:getPrefs` → `AudioPrefsDto`,
  `musex:audio:setPrefs` (prefs) → void.
- `setPrefs` handler: sanitize → `rt.mpv.applyAudioConfig({af: buildAf(p), replaygain: replaygainMode(p)})`
  → persist **after** apply resolves. If mpv rejects the property set, the
  error propagates to the renderer (no silent swallow) and the old prefs stay
  persisted.
- Startup wiring (`runtime.ts`): after constructing `MpvController`, call
  `applyAudioConfig` from persisted prefs (mpv isn't running yet, so this just
  seeds the cache — no spawn).
- Preload: expose `getAudioPrefs` / `setAudioPrefs` on `window.musex`
  (explicit channels, as always).

### 6. UI — `packages/desktop/src/renderer/src/ui/views/SettingsView.tsx` (modify)

New `AudioSection` component mirroring the existing sections: loads prefs on
mount, renders the two selects (`settings-input` styling), optimistic update
with revert + inline error message if `setPrefs` rejects.

## Error handling

- mpv docs warn that a failed runtime `af` reinit can wedge the chain. We only
  ever send strings produced by `buildAf` from a fixed preset table — no
  free-form user filter text, ever.
- `setPrefs` failure: error propagates to the renderer; the select reverts and
  shows the message. Nothing is persisted on failure.
- mpv not running when prefs change: config is cached and applied on next
  spawn — success from the user's perspective (it is the correct durable
  outcome).

## Testing

- `logic/audio-filters.test.ts` (new): `buildAf` for every preset, leveling
  combinations, ordering (EQ before dynaudnorm), empty-string case;
  `replaygainMode`; `sanitizeAudioPrefs` (garbage in → defaults out).
- `logic/mpv-ipc.test.ts` (extend): `cmdSetAf` / `cmdSetReplaygain` shapes.
- Smoke test (`MUSEX_MPV_E2E=1`, extend): set each preset's `af` string and
  `replaygain` value against the real vendored binary and assert the property
  set succeeds — this pins "known-good strings" to the actual shipped mpv.

## Out of scope (deliberate)

- Custom band sliders / graphic EQ UI (presets only this iteration; the
  architecture trivially extends — a custom preset is just another graph
  string).
- `loudnorm` (EBU R128) mode, `crossfeed`, `virtualbass` presets.
- Per-track or per-genre filter profiles.
