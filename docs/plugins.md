# musex plugins (API v2)

musex supports **dynamically loaded plugins**: directories containing a manifest
and a single bundled ESM module, loaded at runtime in a **QuickJS sandbox**
(pure ES + host preamble; bundle target `es2022` / `platform:neutral`).
Plugins are isolated from the main process: they cannot import `node:*` or
`electron` — all host capabilities go through `ctx`. Only install plugins you
trust.

The complete, authoritative type surface is `@musex/plugin-api`
(`packages/plugin-api/src/index.ts`). This document explains how to use it.

> **Breaking change from API v1:** `ctx.fetch` and `ctx.net.client` are gone.
> Use `ctx.net.fetch(url, init?)` instead — see below.

## Bundled integrations

Last.fm is baked into core as a first-party provider (Settings → Last.fm).
Lidarr ships as a user plugin at API v2. Neither is implemented as a PluginHost
plugin.

## User plugins

A user plugin is a directory you drop into `userData/plugins/<id>/`:

```
my-plugin/
├── plugin.json     # manifest
└── index.mjs       # bundled ESM entry
```

### `plugin.json` — the manifest

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "0.1.0",
  "apiVersion": 2,
  "entry": "index.mjs",
  "description": "Optional one-liner shown in Settings"
}
```

Field rules:

| Field | Type | Notes |
| --- | --- | --- |
| `id` | `string` | Must match `^[a-z0-9-]+$`. Unique — first scan wins on duplicates. Use the same value as your directory name. |
| `name` | `string` | Human-readable display name. |
| `version` | `string` | Semver string; shown in Settings. |
| `apiVersion` | `number` | Must equal the host's API version (`2`). A mismatch causes the plugin to be listed as **incompatible** and never activated. |
| `entry` | `string` | Plain filename — no paths, no `./` prefix. The host loads `<pluginDir>/<entry>`. |
| `description` | `string?` | Optional one-liner shown in Settings. |

### Entry contract — `index.mjs`

```ts
import type { PluginContext } from "@musex/plugin-api";

// Required: the host calls this on load/reload.
export function activate(ctx: PluginContext): void | Promise<void> {
  // register things using ctx.*
}

// Optional: the host calls this on disable/reload before re-import.
export function deactivate(): void | Promise<void> {
  // clean up timers, close connections, etc.
}
```

Every `register*` / `contribute*` call on `ctx` returns a `Disposable`
(`{ dispose(): void }`). The host disposes all registered disposables
automatically on disable/reload — you only need to keep them if you want to
unregister early.

### Where user plugins live

**Installed:** `~/Library/Application Support/@musex/desktop/plugins/<id>/` — drop
the directory in and use **Settings → Plugins → Reload plugins** (or restart the
app).

Enable/disable per plugin persists across launches. A plugin that throws during
load or activate is shown as **errored** in Settings and never affects the app or
other plugins. **Reload plugins** disposes every registration, calls
`deactivate()`, and re-imports fresh module code (with a cache-busting query; old
module instances leak until restart — fine for iteration, not a hot path).

Core plugins are also re-activated on Reload (their module is static — no
cache-busting needed; the registry is rebuilt from scratch).

---

## The PluginContext

`activate(ctx)` receives everything a plugin may touch. The sections below
document every field.

### Kernel

| API | Signature | What it does |
| --- | --- | --- |
| `ctx.manifest` | `PluginManifest` | The plugin's own parsed manifest (read-only). |
| `ctx.log` | `(msg: string, ...args: unknown[]) => void` | Console logging prefixed `[plugin:<id>]`. |
| `ctx.storage.get` | `<T>(key: string) => Promise<T \| null>` | Per-plugin JSON storage. Returns `null` when the key is absent. |
| `ctx.storage.set` | `<T>(key: string, v: T) => Promise<void>` | Persist any JSON-serialisable value. |
| `ctx.secrets.get` | `(key: string) => Promise<string \| null>` | Read a safeStorage-encrypted secret. Returns `null` when absent. |
| `ctx.secrets.set` | `(key: string, v: string \| null) => Promise<void>` | Write a safeStorage-encrypted secret. **Passing `null` deletes the key.** |
| `ctx.net.fetch` | `(url: string, init?: NetFetchInit) => Promise<NetFetchResponse>` | HTTP via the host — see below. |
| `ctx.ui.notify` | `(message: string, level?: "info" \| "error") => void` | Toast in the renderer. |
| `ctx.ui.openExternal` | `(url: string) => void` | Open an http(s) URL in the system browser (plugins cannot import `electron`). |

> **API v1 removed:** `ctx.fetch` and `ctx.net.client` no longer exist. Update
> all HTTP calls to use `ctx.net.fetch`.

#### `ctx.net.fetch` — HTTP via the host

Plugins run inside a QuickJS sandbox and cannot reach the outside world
directly. `ctx.net.fetch` is the **only** HTTP capability — it sends the request
from the host (main process) and returns a **serializable response**.

```ts
const res = await ctx.net.fetch("https://api.example.com/data", {
  method: "GET",
  headers: { "Authorization": `Bearer ${token}` },
});
if (res.ok) {
  const data = JSON.parse(res.body);
}
```

**Interfaces:**

```ts
interface NetFetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  /** Skip TLS certificate verification — for self-hosted servers behind a
   *  self-signed cert. Default: false. */
  allowSelfSigned?: boolean;
}

interface NetFetchResponse {
  ok: boolean;           // status in 200–299
  status: number;
  headers: Record<string, string>;
  body: string;          // response body as text; binary bodies are out of scope
}
```

**Security caveat:** `allowSelfSigned: true` disables TLS certificate
verification, making the connection vulnerable to man-in-the-middle attacks. Use
only when you control the server and cannot issue a CA-signed cert. The
recommended alternative is adding your server's CA certificate to the OS trust
store.

---

### Events — `ctx.events.on(name, handler)`

Playback lifecycle and curated domain events. Returns a `Disposable`.

```ts
const disposable = ctx.events.on("trackStarted", ({ track, startedAtEpochSec }) => {
  // ...
});
```

Handler errors are **isolated per subscriber** — a throwing handler is logged
and never breaks playback or other plugins.

| Event | Payload type | When it fires |
| --- | --- | --- |
| `trackStarted` | `{ track: TrackInfo; startedAtEpochSec: number }` | A track first becomes audible. A paused restore does **not** fire until the user actually plays. |
| `paused` | `{ track: TrackInfo }` | After a `trackStarted`, the track is paused. |
| `resumed` | `{ track: TrackInfo }` | After a `paused`, playback resumes. |
| `trackEnded` | `{ track: TrackInfo; playedSec: number }` | A play-through closes (track change or stop). |
| `scrobble` | `{ track: TrackInfo; startedAtEpochSec: number }` | **Curated:** once per play-through when the scrobble gate passes (length > 30s AND played ≥ half or ≥ 4 min — real audible time; pauses and seeks don't count). Use this event to submit scrobbles; do not implement your own gate. |
| `trackRated` | `{ track: TrackInfo; rating10: number \| null }` | The user rates (or clears the rating of) a track. `rating10` is the Plex 0–10 scale (stars × 2); `null` = rating cleared. **Artist ratings do NOT fire this event.** |

All track data is `TrackInfo`:

```ts
type TrackInfo = {
  title: string;
  artistName: string;
  albumTitle?: string;
  durationMs: number;
  trackNumber?: number;
};
```

**No ids, stream URLs, or tokens ever cross the plugin boundary.**

---

### Library (read-only) — `ctx.library`

```ts
ctx.library.search(query: string): Promise<LibrarySearchResult>
ctx.library.recentlyPlayed(limit?: number): Promise<TrackInfo[]>
ctx.library.topArtists(limit?: number): Promise<{ name: string; score: number }[]>
```

| Method | What it returns |
| --- | --- |
| `search(query)` | `{ artists: {id,name}[], albums: {id,title,artistName}[], tracks: TrackInfo[] }` — opaque `id` strings for artists/albums. |
| `recentlyPlayed(limit?)` | Host-tracked listening history, most recent first. `limit` defaults to a host-defined cap. |
| `topArtists(limit?)` | Artists ordered by decayed affinity score, best first. May be empty until the user has listened or rated enough. `score` is a dimensionless float (higher = stronger affinity). |

---

### UI contribution points

Data-only: the host owns all rendering. Every `contribute*` / `register*` call
returns a `Disposable`.

#### `ctx.ui.contributeSections(target, provider)`

```ts
ctx.ui.contributeSections(
  target: "discover" | "home",
  provider: SectionProvider
): Disposable

interface SectionProvider {
  id: string;
  getSections(ctx: SectionContext): Promise<Section[]>;
}

interface SectionContext {
  recentArtists: string[];
  recentTracks: { title: string; artist: string }[];
  /** Host taste profile: artists by decayed affinity, best first. */
  topArtists: { name: string; score: number }[];
}

interface Section {
  title: string;
  items: {
    name: string;
    artistName?: string;
    imageUrl?: string;
    externalUrl?: string;
  }[];
}
```

Provider receives the host taste context (use `topArtists` for best results;
fall back to `recentArtists` when the profile is sparse). The host matches item
`name` values against the library **case-insensitively**: owned items navigate
into the app; unowned items get an "external" badge and open `externalUrl`.

Providers run with an **~8s timeout and full isolation** — a throw or timeout
causes that provider's sections to be skipped silently. Other providers and
playback are unaffected.

Image URLs must be `http(s)` (no `file:` or `data:`). The host proxies and
caches them; relative URLs are not supported.

#### `ctx.ui.contributeTrackAction(action)`

```ts
ctx.ui.contributeTrackAction(action: TrackAction): Disposable

interface TrackAction {
  id: string;
  label: string;        // e.g. "Love on Last.fm"
  icon?: string;        // lucide icon name (see allowlist below)
  onInvoke(track: TrackInfo): Promise<void>;
}
```

Appears in the track context menu. `icon` must be one of `heart`, `star`, or
`external-link`; anything else renders the generic plugin icon.

#### `ctx.ui.contributeTrackDetail(provider)`

```ts
ctx.ui.contributeTrackDetail(provider: TrackDetailProvider): Disposable

interface TrackDetailProvider {
  id: string;
  getDetail(
    track: TrackInfo,
  ): Promise<{ title: string; rows: { label: string; value: string }[] } | null>;
}
```

Returns key-value rows for the selected track's slide-out panel. **Returning
`null` renders nothing** — the section is completely omitted. Same ~8s timeout
and isolation as section providers.

#### `ctx.ui.registerSimilarProvider(provider)`

```ts
ctx.ui.registerSimilarProvider(provider: SimilarProvider): Disposable

interface SimilarProvider {
  id: string;
  similarArtists?(artistName: string): Promise<SimilarItem[]>;
  similarTracks?(seed: { title: string; artist: string }): Promise<SimilarItem[]>;
  /** Artist's most popular albums, best first. */
  topAlbums?(artistName: string): Promise<{ title: string }[]>;
  /** Artist bio/stats. Return null for unknown artists. */
  artistInfo?(artistName: string): Promise<ArtistInfo | null>;
}

type SimilarItem = {
  name: string;
  artistName?: string;   // set for similar TRACKS (the song's artist)
  imageUrl?: string;
  externalUrl?: string;
  /** Similarity 0..1. Taste expansion uses this; the Similar panel ignores it. */
  match?: number;
};

interface ArtistInfo {
  name: string;
  bio?: string;          // plain text, no HTML
  url?: string;          // provider page (e.g. last.fm URL)
  listeners?: number;
  playCount?: number;
  imageUrl?: string;
}
```

Powers the Similar side panel (artist pages → similar artists; track detail →
similar songs) and host-side taste expansion. Implement only the methods your
source supports — all are optional.

- `similarArtists` / `similarTracks` — feeds the Similar panel and taste
  expansion. The host matches results against the library: owned artists
  navigate; owned tracks become playable tiles.
- `topAlbums` — taste expansion acquires the top entry as the "start here" album
  for a new artist. The External Artist view also merges these titles into the
  discography (titles no acquisition provider knows render as `unavailable`).
- `artistInfo` — powers the artist-info side panel. First provider with a
  non-null answer wins.

Same ~8s timeout and isolation as section providers apply to all methods.

---

### Radio — `ctx.registerTrackRecommender(recommender)`

```ts
ctx.registerTrackRecommender(recommender: TrackRecommender): Disposable

interface TrackRecommender {
  id: string;
  recommend(ctx: RecommendContext): Promise<RecommendedTrack[]>;
}

interface RecommendContext {
  seedTracks: { title: string; artist: string }[];
  seedArtists: string[];
  /** Already queued / recently played — do not re-suggest. */
  exclude: { title: string; artist: string }[];
  count: number;
}

/** title absent = artist-level suggestion; the host picks tracks by that artist. */
type RecommendedTrack = { artistName: string; title?: string };
```

Feeds radio: the host calls `recommend` when its auto-extending queue runs low.
Plugins only **suggest** — the host resolves suggestions against the library and
owns the queue. Suggestions that don't match anything in the library are silently
dropped.

---

### Acquisition — `ctx.registerAcquisitionProvider(provider)`

Powers the External Artist view (discography lookup with per-album state) and
the Downloads view (merged `status()` items). This is a service registration,
not a UI contribution.

```ts
ctx.registerAcquisitionProvider(provider: AcquisitionProvider): Disposable
```

#### Full `AcquisitionProvider` interface

```ts
interface AcquisitionProvider {
  id: string;

  // ── Required ────────────────────────────────────────────────────────────────

  /** Discography for the named artist. Return [] when the artist is unknown. */
  lookupArtistAlbums(artistName: string): Promise<AcquirableAlbum[]>;

  /** Request acquisition of one album identified by providerRef (see below). */
  acquireAlbum(providerRef: string): Promise<void>;

  /** Active downloads + monitored-but-missing albums; polled while the
   *  Downloads view is open. */
  status(): Promise<AcquisitionStatusItem[]>;

  // ── Optional ────────────────────────────────────────────────────────────────

  /** External artist search — federated into the app's "Not in your library"
   *  section. Return [] or omit the method if not supported. */
  searchArtists?(term: string): Promise<ExternalArtistResult[]>;

  /** Monitor EVERYTHING by this artist and kick off a search. */
  acquireArtist?(providerRef: string): Promise<void>;

  /** Stop pursuing an album (unmonitor; NEVER delete files). Taste expansion
   *  calls this when the user taps "Not for me" or on abandon. */
  cancelAlbum?(providerRef: string): Promise<void>;

  /** Watch/unwatch an artist for FUTURE releases.
   *  Enabling MUST NOT monitor the artist's existing albums.
   *  Disabling MUST NOT unmonitor albums that were monitored independently. */
  watchNewReleases?(artistName: string, enabled: boolean): Promise<void>;

  /** Is this artist currently watched for new releases? */
  isWatchingNewReleases?(artistName: string): Promise<boolean>;

  /** Names of all artists currently watched for new releases. */
  listWatchedArtists?(): Promise<string[]>;

  /** Names of artists currently monitored by the provider.
   *  Feeds "monitored" tile badges. The host caches the answer for ~60s
   *  and drops the cache after any `acquireArtist` call. */
  listMonitoredArtists?(): Promise<string[]>;
}
```

#### Supporting types

```ts
interface AcquirableAlbum {
  title: string;
  artistName: string;
  year?: number;
  imageUrl?: string;
  /** Opaque — pass back unchanged to acquireAlbum / cancelAlbum. */
  providerRef: string;
  /** Host adds "owned" by library cross-check; never return "owned" yourself. */
  state: "downloaded" | "downloading" | "requested" | "available" | "unavailable";
  /** e.g. "7/12 tracks", "no release found" */
  detail?: string;
}

interface AcquisitionStatusItem {
  title: string;
  artistName: string;
  state: "owned" | "downloaded" | "downloading" | "requested" | "available" | "unavailable";
  /** 0..1 */
  progress?: number;
  detail?: string;
}

interface ExternalArtistResult {
  name: string;
  /** Opaque — pass back to acquireArtist. */
  providerRef: string;
  imageUrl?: string;
  externalUrl?: string;
  /** e.g. "UK trip-hop duo" — disambiguates same-named artists. */
  disambiguation?: string;
  /** True when the artist is already fully monitored in the provider. */
  monitored?: boolean;
}
```

#### The `providerRef` contract

`providerRef` is **opaque to the host** — it passes the string you set on an
`AcquirableAlbum` or `ExternalArtistResult` back to your `acquireAlbum`,
`acquireArtist`, or `cancelAlbum` unchanged. Encode whatever your acquisition
flow needs:

```ts
// In lookupArtistAlbums / searchArtists — stringify on create:
const ref = JSON.stringify({ foreignAlbumId: "abc123", artistName: "Portishead" });
out.push({ ..., providerRef: ref });

// In acquireAlbum / cancelAlbum — parse on receipt:
const { foreignAlbumId, artistName } = JSON.parse(providerRef);
```

The host never inspects the contents. The string must survive a round-trip
through IPC (i.e. JSON-serialisable, no `undefined`/`NaN`).

#### `listMonitoredArtists` cache

The host caches `listMonitoredArtists()` results for **approximately 60 seconds**
and drops the cache immediately after any `acquireArtist` call. This means tile
badges may lag briefly after a manual action in your provider's UI; after an
in-app acquire the badge updates on the next navigation.

#### New-release watch semantics

`watchNewReleases(artistName, enabled)`:

- **Enabling** — watch the artist for FUTURE releases only. Do not separately
  monitor existing albums; the user can acquire those explicitly.
- **Disabling** — stop watching for new releases only. Do not unmonitor albums
  that were requested/monitored through a separate acquisition path.

---

### Settings — declarative, host-rendered

```ts
ctx.registerSettings(schema: SettingField[]): void
ctx.onSettingsAction(key: string, handler: () => Promise<SettingsActionResult>): void

type SettingsActionResult = { ok: boolean; message?: string };
```

The host renders the settings form; plugins never ship UI.

```ts
ctx.registerSettings([
  { kind: "text",     key: "serverUrl",  label: "Server URL",  help: "e.g. http://192.168.1.5:8686" },
  { kind: "password", key: "apiKey",     label: "API key" },
  { kind: "toggle",   key: "enabled",    label: "Enable feature", help: "Optional help text" },
  { kind: "action",   key: "connect",    label: "Connect account" },
  { kind: "status",   key: "connection" },
]);

ctx.onSettingsAction("connect", async () => {
  // Runs in main; button shows busy until this returns.
  return { ok: true, message: "Connected as someone" };
});
```

| `kind` | Behavior |
| --- | --- |
| `text` | Plain text input; value stored under `key` in `ctx.storage`. |
| `password` | Text input with hidden value; stored under `key` in `ctx.secrets` (safeStorage-encrypted). The renderer only ever sees `{ set: boolean }` — never the actual value. |
| `toggle` | Boolean checkbox; value stored in `ctx.storage`. |
| `action` | Button; fires `onSettingsAction(key)`. The button shows a busy state until the handler returns `{ ok, message? }`. |
| `status` | Read-only line. The value is whatever the plugin last wrote to `ctx.storage` under the same `key`. Useful for displaying connection status. |

Field vocabulary is **fixed** — `text`, `password`, `toggle`, `action`,
`status`. New field kinds require a host change so every plugin gains the
rendering for free; plugins never ship their own UI.

---

### Image URLs

Image URLs passed in any contribution point (`imageUrl` on section items,
`SimilarItem`, `AcquirableAlbum`, etc.) must be **absolute `http` or `https`
URLs**. The host proxies and caches them for display.

- `file:` and `data:` URLs are not supported.
- Relative URLs are not supported.
- The URL must be publicly reachable (or reachable from the host machine for
  local servers).

---

## Building a user plugin

Bundle your source to a single ESM file and create a `plugin.json` manifest.

### esbuild recipe

```js
// build.mjs
import { build } from "esbuild";
import { copyFile } from "node:fs/promises";

await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.mjs",
  bundle: true,
  format: "esm",
  target: "es2022",
  platform: "neutral",  // QuickJS sandbox: no node: builtins available
  external: [],         // bundle everything; @musex/plugin-api is types-only
});
await copyFile("plugin.json", "dist/plugin.json");
```

`@musex/plugin-api` is **types-only** — import it freely and it contributes
nothing to the bundle. Do **not** import `node:*`, `electron`, or any `@musex`
runtime module: the plugin runs in a QuickJS sandbox. Use `ctx.net.fetch` for
all HTTP. The manifest, `ctx`, and the types are your complete contract.

### Installing

Drop the `dist/` contents (or your output directory containing `index.mjs` +
`plugin.json`) into:

```
~/Library/Application Support/@musex/desktop/plugins/<id>/
```

Then go to **Settings → Plugins → Reload plugins**.

Note: GitHub-based install (one-click install from a repo release) is planned
for a later musex release. For now, the manual drop-in is the only install path.

---

## Trust model (read this)

**Sandboxed, by design.** Plugins run in a QuickJS isolate with **no access to
the filesystem, the OS, Node, Electron, the Plex token/stream URLs, or other
plugins' data** — they reach the app *only* through the `ctx` API (the bridge is
the security boundary). What a plugin *can* do: make network requests
(`ctx.net.fetch`), read/write its own `storage`/`secrets`, and see the
`TrackInfo`/search/taste data the API exposes. So the residual risk is **data
exfiltration over the network** — a malicious plugin could send the credentials
*you* gave it (e.g. a server API key) or your listening data to a remote server.
It can't harm your machine, but **install only plugins you trust** with the
settings you enter into them.
