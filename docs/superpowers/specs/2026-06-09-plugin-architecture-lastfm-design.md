# Spec: Plugin Architecture + last.fm Plugin (scrobbling + Discover)

**Status:** decisions confirmed with user 2026-06-09.

## Decisions (confirmed)

1. **Dynamically loadable plugins** — plugin code is NOT compiled into the app; it's loaded at runtime. Primary motivation: **iterate on plugins without touching/releasing the app** (separate packages, reload in place). Ecosystem polish (install UI, marketplace) is explicitly out of scope for v1 but the manifest/apiVersion contract is designed so it can be added without breaking plugins.
2. **Full-trust model** (Obsidian/VS Code style): plugins are ESM modules `import()`ed in the **main process** with full Node privileges. The host hands each plugin a capability object and politely nothing else; there is no hard sandbox. Security posture = "only install what you trust", documented. A `utilityProcess` sandbox can be introduced later behind the same extension points.
3. **Plugins are data-only toward the UI.** They declare settings as a schema and return discovery *data*; the host renders everything with musex components. Plugins never ship renderer code in v1.
4. **last.fm is the first plugin**: scrobbling + a **dedicated Discover view**. API key/secret are **user-supplied** in the plugin's settings (nothing secret in the repo).

## Architecture

```
renderer                          main
────────                          ────
Settings → Plugins section ─IPC─► PluginHost (scan, manifest check, import(), activate(ctx))
Discover view ─────────────IPC─►   ├─ registry: scrobblers, discovery providers, settings schemas
PlaybackSession ──nowPlaying──►    ├─ PlaybackMonitor (host-side scrobble gate)
                                   └─ per-plugin ctx: storage / secrets / fetch / log / register*
                                          ▲
                              userData/plugins/<id>/   (+ repo plugins/*/dist in dev)
                                plugin.json + index.mjs   e.g. @musex/plugin-lastfm
```

### Plugin package & loading

- **A plugin is a directory**: `plugin.json` manifest + a single bundled ESM entry.
  ```json
  { "id": "lastfm", "name": "Last.fm", "version": "0.1.0",
    "apiVersion": 1, "entry": "index.mjs", "description": "Scrobbling + discovery via Last.fm" }
  ```
- **Entry contract**: `export function activate(ctx: PluginContext): void | Promise<void>` and optional `export function deactivate(): void | Promise<void>`.
- **Scan locations** (in order; first id wins): `userData/plugins/<id>/`, and in dev additionally `<repo>/plugins/*/dist/`. Loaded at app start; per-plugin enable/disable persisted (electron-store).
- **Reload without app release**: a "Reload plugins" action (Settings) deactivates all, re-imports entries with a cache-busting query (`index.mjs?t=<n>`), re-activates. Good enough for v1 iteration; file-watching hot reload is a later nicety.
- **Isolation by policy, not mechanism**: every host→plugin call is try/caught; a throwing plugin is marked errored (shown in Settings) and skipped — a broken plugin must never break playback or the app.
- **apiVersion gate**: host supports `apiVersion: 1`; mismatch → plugin listed as incompatible, not loaded.
- **Monorepo home for first-party plugins**: `plugins/lastfm/` workspace package (`@musex/plugin-lastfm`), bundled by **esbuild** to `plugins/lastfm/dist/{plugin.json,index.mjs}` (single file, `@musex/core` types used at compile time only). Its build is independent of the app build — that's the "iterate without touching the app" property. (esbuild version verified current at plan time.)

### PluginContext API (v1) — small kernel + generic contribution points

Design principle: instead of one bespoke interface per feature (a `Scrobbler`, a
`DiscoveryProvider`, …), the API is a **kernel of general capabilities** (events,
library access, storage/secrets/fetch, notifications, settings) plus **generic,
data-only contribution points** (sections, track actions, detail sections). Each
concrete feature is an *instance* of these: scrobbling = an event subscriber;
discovery = a section contribution targeting the Discover view. New plugin ideas
(Discord presence, stats, lyrics, ListenBrainz) need no new API surface.

```ts
interface PluginContext {
  manifest: PluginManifest;
  log: (msg: string, ...args: unknown[]) => void;            // prefixed console
  storage: { get<T>(key: string): Promise<T | null>; set<T>(key: string, v: T): Promise<void> };
  secrets: { get(key: string): Promise<string | null>; set(key: string, v: string | null): Promise<void> }; // safeStorage-encrypted
  fetch: typeof fetch;                                        // convenience; full trust anyway

  // ── events (generalizes "Scrobbler"): playback lifecycle + curated domain events
  events: {
    on<K extends keyof PluginEvents>(event: K, handler: (payload: PluginEvents[K]) => void): Disposable;
  };

  // ── read-only library access (matching, taste profiles, dedupe — any plugin)
  library: {
    search(query: string): Promise<LibrarySearchResult>;       // artists/albums/tracks with opaque ids
    recentlyPlayed(limit?: number): Promise<TrackInfo[]>;      // host-tracked history
  };

  // ── UI (data-only; host renders everything)
  ui: {
    notify(message: string, level?: "info" | "error"): void;   // toast
    contributeSections(target: "discover" | "home", provider: SectionProvider): Disposable;
    contributeTrackAction(action: TrackAction): Disposable;    // context menu + detail panel
    contributeTrackDetail(provider: TrackDetailProvider): Disposable; // slide-out panel section
  };

  // ── settings (declarative; host renders the form)
  registerSettings(schema: SettingField[]): void;
  onSettingsAction(key: string, handler: () => Promise<SettingsActionResult>): void; // e.g. "Connect"
}

interface PluginEvents {
  trackStarted: { track: TrackInfo; startedAtEpochSec: number };
  trackEnded: { track: TrackInfo; playedSec: number };
  paused: { track: TrackInfo };
  resumed: { track: TrackInfo };
  /** Curated: fires once per play-through when the host's scrobble gate passes
   *  (last.fm thresholds — see pipeline below). Subscribers scrobble; that's all
   *  "being a scrobbler" means. */
  scrobble: { track: TrackInfo; startedAtEpochSec: number };
}

interface SectionProvider {
  id: string;
  getSections(ctx: SectionContext): Promise<Section[]>;
}
interface SectionContext { recentArtists: string[]; recentTracks: { title: string; artist: string }[] }
interface Section {
  title: string;                                               // e.g. "Because you listened to Lamb"
  items: { name: string; artistName?: string; imageUrl?: string; externalUrl?: string }[];
}

interface TrackAction {
  id: string;
  label: string;                                               // e.g. "Love on Last.fm"
  icon?: string;                                               // lucide icon name; host resolves
  onInvoke(track: TrackInfo): Promise<void>;
}

interface TrackDetailProvider {
  id: string;
  /** Key-value rows / short text for the selected track's panel (playcount, tags, …). */
  getDetail(track: TrackInfo): Promise<{ title: string; rows: { label: string; value: string }[] } | null>;
}

type SettingField =
  | { kind: "text" | "password"; key: string; label: string; help?: string }
  | { kind: "toggle"; key: string; label: string; help?: string }
  | { kind: "action"; key: string; label: string; help?: string }   // button → onSettingsAction
  | { kind: "status"; key: string };                                 // read-only line the plugin updates

type TrackInfo = { title: string; artistName: string; albumTitle?: string; durationMs: number; trackNumber?: number };
type Disposable = { dispose(): void };
```

**Named for v2 (shape reserved, NOT built in v1):**
- `ctx.player` — queue/playback control (`enqueue`, `playTracks`, `getState`): enables last.fm-radio / AI-DJ / smart-queue plugins, but needs new main→renderer command plumbing and nothing in v1 requires it.
- `MetadataProvider` — external metadata enrichment (the roadmap's metadata-search feature will define it).
- `AcquisitionProvider` — "I can acquire this external item" (the Lidarr spec will define it; Discover's unowned badge is its entry point).
- `ctx.commands` — command-palette registration, when a palette exists.

### Playback events pipeline (host-side; plugins subscribe)

- The **renderer session** notifies main over a new IPC (`playbackNowPlaying`) on track start / pause / resume / track change / stop, carrying the `TrackInfo`. (Restore-paused does NOT notify until the user actually plays.)
- Main's **PlaybackMonitor** combines that with the mpv position events it already sees to accumulate *actual played time* per track (robust to pause/seek: accumulate deltas only while playing, ignore jumps > ~2s as seeks). It emits the `trackStarted/trackEnded/paused/resumed` plugin events and feeds the host's recently-played history (which also backs `ctx.library.recentlyPlayed` and `SectionContext`).
- **Scrobble gate (pure, unit-tested, `logic/scrobble-gate.ts`)** — last.fm rules verified 2026-06-09: track length > 30s AND played ≥ half its duration or ≥ 4 minutes (whichever comes first). Fires the curated `scrobble` event once per play-through, on track end/change.
- Plugins receive only `TrackInfo` — no ids, URLs, or tokens.

### Renderer surfaces

- **Settings → Plugins**: list (name, version, enabled toggle, error state), Reload plugins, and a per-plugin settings form rendered from the declarative schema (text/password/toggle/action/status). Values round-trip over IPC to the plugin's storage/secrets (password fields → secrets); action buttons invoke `onSettingsAction` and show the returned status/error.
- **Discover view** (new nav item, lucide `Compass`): host collects sections from all providers contributed to `"discover"` (per-provider try/catch + timeout), renders rows of cards. Each item is **matched against the library** (search by artist/name, best-effort) — owned items navigate to their artist/album page; unowned items show an "external" badge (the future Lidarr acquisition hook) and link out via `externalUrl`. Home renders `"home"`-targeted contributions below its built-in rows with the same machinery.
- **Plugin-contributed track actions** render in the track context menu (below "Go to album") and the detail panel; **track-detail contributions** render as extra panel sections.
- New IPC: `plugins:list / setEnabled / reload / getSettingsSchema / getSettingsValues / setSettingsValue / settingsAction`, `sections:get (target)`, `trackActions:list / invoke`, `trackDetail:get`, `playbackNowPlaying` (renderer→main notify), `pluginNotify` (main→renderer toast push).

## last.fm plugin (v1 scope)

- **Settings**: API key (text), shared secret (password→secrets), "Connect last.fm account" (action), status line ("Connected as <user>" / "Not connected").
- **Auth** (desktop flow, verified 2026-06-09): `auth.getToken` → `shell`-opened browser to `last.fm/api/auth/?api_key=…&token=…` → user approves → `auth.getSession` (poll a few times after the action, token valid 60 min) → store session key in `secrets`. All signed calls: `api_sig = md5(concat(sorted param name+value pairs) + secret)` (`node:crypto`), POST form-encoded to `https://ws.audioscrobbler.com/2.0/`.
- **Scrobbling** (event subscriber): on `trackStarted` → `track.updateNowPlaying` (never retried, per last.fm guidance); on `scrobble` → `track.scrobble` (artist, track, timestamp=startedAt, album, duration). Failures logged, never retried in v1 (offline scrobble queueing is a listed follow-up).
- **Discover sections**: `ui.contributeSections("discover", …)` — for the host-provided recent artists, `artist.getSimilar` → "Because you listened to X" sections (top ~10 similar each, capped at 3 sections). last.fm artist images are mostly defunct — items render with the placeholder/initial art; owned matches use library art.
- **Track action**: "Love on Last.fm" (`track.love`) — exercises the generic action point end-to-end and surfaces a toast via `ui.notify`.

## Out of scope (v1, listed deliberately)

Plugin install/marketplace UI (drop a folder in `userData/plugins/` instead) · sandboxing · plugin-supplied renderer UI · offline scrobble queue · last.fm loved-tracks/import · Lidarr (separate spec; Discover's "unowned" badge is its entry point).

## Testing

- Pure + unit-tested: manifest validation, scrobble gate (the threshold/pause/seek rules), api_sig construction, settings-schema validation.
- PluginHost: tested against a fixture plugin directory (tmp dir with a tiny manifest+entry) — load, activate, error isolation, reload.
- last.fm HTTP calls behind a thin client interface; plugin logic tested with a fake. One env-gated smoke test (`MUSEX_LASTFM_E2E=1`) against the real API with user creds.
- Manual acceptance: connect account; play a track ≥ half → appears in last.fm profile; Discover shows similar-artist rows; owned items navigate; disabled plugin = no calls; broken plugin dir doesn't break the app.

## Phases

1. **Plugin host kernel**: manifest/loader/registry, ctx (storage/secrets/log/fetch/settings, `ui.notify`), Settings→Plugins UI, reload. Fixture-plugin tests.
2. **Events pipeline**: `playbackNowPlaying` IPC, PlaybackMonitor + recently-played history, scrobble gate (tested), `ctx.events` + `ctx.library` (search, recentlyPlayed).
3. **last.fm plugin**: package + independent esbuild, auth flow, scrobbling via events, "Love" track action. First real end-to-end (incl. the `trackActions` contribution point).
4. **Discover + sections**: `contributeSections` (discover + home targets), Discover view + library matching, last.fm similar-artists provider, `contributeTrackDetail` point.
5. **Docs**: `docs/plugins.md` — manifest, API v1 (kernel + contribution points), how to build/install a plugin.

## Risks / notes

- `import()` of user-dir ESM is straightforward in dev; in a **packaged** app, bundled first-party plugins must live outside the asar (`extraResources`) — folds into the deferred packaging phase.
- Reload can't truly unload module code (ESM cache) — cache-busting query leaks old module instances on each reload; acceptable for a dev-time action.
- last.fm rate limits are generous for one user; Discover responses cached per session (and re-fetched on view open) to stay polite.
- The Plex token never crosses the plugin API; plugins get `TrackInfo` only. Full-trust means a malicious plugin could still do harm — that's the accepted, documented posture.
