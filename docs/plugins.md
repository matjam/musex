# musex plugins (API v1)

musex supports **dynamically loaded plugins**: directories containing a manifest
and a single bundled ESM module, loaded at runtime in the Electron **main
process**. Plugins are **full-trust** — they run with Node privileges, like
Obsidian or VS Code extensions. Only install plugins you trust.

The complete, authoritative type surface is `@musex/plugin-api`
(`packages/plugin-api/src/index.ts`). This document explains how to use it.

## Anatomy of a plugin

```
my-plugin/
├── plugin.json     # manifest
└── index.mjs       # bundled ESM entry
```

`plugin.json`:

```json
{
  "id": "my-plugin",          // ^[a-z0-9-]+$ — unique; first scan wins on duplicates
  "name": "My Plugin",
  "version": "0.1.0",
  "apiVersion": 1,             // must equal the host's API version or the plugin is listed as incompatible
  "entry": "index.mjs",        // plain filename, no paths
  "description": "Optional one-liner shown in Settings"
}
```

`index.mjs` (what the bundle must export):

```ts
import type { PluginContext } from "@musex/plugin-api";

export function activate(ctx: PluginContext): void | Promise<void> { /* register things */ }
export function deactivate(): void | Promise<void> { /* optional cleanup */ }
```

## Where plugins live

- **Installed:** `~/Library/Application Support/@musex/desktop/plugins/<id>/` —
  drop the directory in and use **Settings → Plugins → Reload plugins** (or
  restart the app).
- **Development (repo checkouts only):** `<repo>/plugins/<name>/dist/` is also
  scanned when the app runs unpackaged — first-party plugins live here as
  workspace packages and are loaded straight from their build output.

Enable/disable per plugin persists across launches. A plugin that throws during
load or activate is shown as **errored** in Settings and never affects the app
or other plugins. **Reload plugins** disposes every registration, calls
`deactivate()`, and re-imports fresh module code (with a cache-busting query;
old module instances leak until restart — fine for iteration, not a hot path).

## The PluginContext

`activate(ctx)` receives everything a plugin may touch. Every `register*` /
`contribute*` call returns a `Disposable`; the host disposes them automatically
on disable/reload, so you only keep them if you want to unregister early.

### Kernel

| API | What it is |
| --- | --- |
| `ctx.log(msg, ...)` | console logging prefixed `[plugin:<id>]` |
| `ctx.storage.get/set` | per-plugin JSON storage (`plugin-data/<id>.json`) |
| `ctx.secrets.get/set` | per-plugin secrets, **safeStorage-encrypted at rest** (`set(key, null)` deletes) |
| `ctx.fetch` | global fetch |
| `ctx.ui.notify(message, level?)` | toast in the app |
| `ctx.ui.openExternal(url)` | open an http(s) URL in the system browser (plugins cannot import electron) |

### Events — `ctx.events.on(name, handler)`

Playback lifecycle, host-computed. Handlers are isolated per subscriber (a
throwing handler is logged, never breaks playback or other plugins).

| Event | Payload | Fires |
| --- | --- | --- |
| `trackStarted` | `{ track, startedAtEpochSec }` | a track first becomes audible (a paused restore does NOT fire until played) |
| `paused` / `resumed` | `{ track }` | after a `trackStarted` |
| `trackEnded` | `{ track, playedSec }` | play-through closes (track change/stop) |
| `scrobble` | `{ track, startedAtEpochSec }` | **curated**: once per play-through when the scrobble gate passes (length > 30s AND played ≥ half or ≥ 4 min, real audible time — pauses and seeks don't count) |

All track data is `TrackInfo` — title/artist/album/duration/track# only. **No
ids, stream URLs, or tokens ever cross the plugin boundary.**

### Library (read-only) — `ctx.library`

- `search(query)` → `{ artists, albums, tracks }` (names/titles + opaque ids)
- `recentlyPlayed(limit?)` → host-tracked listening history (`TrackInfo[]`, most recent first)

### UI contribution points — data only, the host renders everything

- `ctx.ui.contributeSections("discover" | "home", provider)` — provider returns
  `Section[]` (`{title, items: [{name, artistName?, imageUrl?, externalUrl?}]}`)
  given a `SectionContext` (`recentArtists`, `recentTracks`). The host matches
  item names against the library: owned items navigate into the app; unowned
  items get an "external" badge and open `externalUrl`. Providers get an 8s
  timeout; failures are skipped, never shown as errors.
- `ctx.ui.contributeTrackAction({id, label, icon?, onInvoke})` — appears in the
  track context menu. `icon` is a lucide name from the host's allowlist
  (`heart`, `star`, `external-link`); anything else renders the generic plugin icon.
- `ctx.ui.contributeTrackDetail(provider)` — `getDetail(track)` returns
  `{title, rows: [{label, value}]} | null`; rendered as an extra section in the
  track slide-out panel.
- `ctx.ui.registerSimilarProvider({id, similarArtists?, similarTracks?})` —
  powers the Similar side panel ("Similar Artists" on artist pages, "Similar
  Songs" in the track panel). Return `SimilarItem[]` (`{name, artistName?,
  imageUrl?, externalUrl?}`); the host matches items against the library
  (owned artists navigate; owned tracks become playable tiles) and proxies/
  caches external images. Same 8s timeout + isolation as sections.
- `ctx.registerTrackRecommender({id, recommend})` — feeds radio: given seeds +
  excludes, return `RecommendedTrack[]` (`{artistName, title?}`; no title =
  artist-level). The host resolves suggestions against the library and appends
  real tracks to the queue.

### Settings — declarative, host-rendered

```ts
ctx.registerSettings([
  { kind: "text",     key: "apiKey",  label: "API key", help: "where to get one" },
  { kind: "password", key: "secret",  label: "Secret" },          // stored in ctx.secrets; renderer only ever sees { set: boolean }
  { kind: "toggle",   key: "enabled", label: "Do the thing" },
  { kind: "action",   key: "connect", label: "Connect account" }, // button
  { kind: "status",   key: "connection" },                        // read-only; value comes from ctx.storage["connection"]
]);
ctx.onSettingsAction("connect", async () => {
  // long-running OK; the button shows busy until you return
  return { ok: true, message: "Connected as someone" };
});
```

Field vocabulary is fixed (text/password/toggle/action/status). If a plugin
needs a new field kind, the kind gets added to the host so every plugin gains it
— plugins never ship UI.

## Building a plugin

Use `plugins/lastfm/` as the reference implementation (auth flow, event
subscriber, Discover provider, track action, detail provider). The build recipe:

```js
// build.mjs — bundle to a single ESM file + copy the manifest
import { build } from "esbuild";
import { copyFile, mkdir } from "node:fs/promises";
await build({ entryPoints: ["src/index.ts"], outfile: "dist/index.mjs",
              bundle: true, format: "esm", platform: "node" });
await copyFile("plugin.json", "dist/plugin.json");
```

`@musex/plugin-api` is types-only — import it freely; nothing of it lands in the
bundle. `node:*` builtins are available (main process). Do not import `electron`
or musex runtime modules; the manifest validator and ctx are your whole contract.
First-party repo plugins: `pnpm build:plugins` builds every `plugins/*` package.

## Trust model (read this)

Full trust, by design: a plugin is arbitrary code in the main process. The ctx
API is the *supported* surface, not a security boundary. musex never hands
plugins the Plex token, stream URLs, or library ids beyond search results — but
a malicious plugin doesn't need the API to do harm. Install only what you trust.
