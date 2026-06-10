# Lidarr Acquisition — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. This header is the design (agreed in conversation 2026-06-09).

**Goal:** A Lidarr plugin behind a new `AcquisitionProvider` extension point. External (unowned) artists open an in-app **External Artist** view showing their discography with per-album state (downloaded / downloading / requested / available-to-add / **unavailable**) and an Add-to-Lidarr action. A **Downloads** view shows the status of requested items. Clicking an external artist no longer bounces to last.fm when an acquisition provider is registered.

**Constraints/decisions:**
- Lidarr is **album-level** — track requests resolve to their album; the UI says "albums".
- `AcquisitionProvider` is the v2-reserved extension point finally built — additive, apiVersion stays 1.
- Acquire routing: every lookup item carries `{providerId, providerRef}` (opaque, e.g. MusicBrainz foreignAlbumId); acquire dispatches to that provider.
- "Owned" detection: the host cross-checks lookup results against the Plex library (artist owned → album title case-insensitive match) so partially-owned discographies render correctly.
- Lidarr endpoints MUST be verified against https://lidarr.audio/docs/api/ (OpenAPI) during Task 2 — do not trust memory. Expected surface (verify all): `X-Api-Key` header auth; `GET /api/v1/system/status` (test connection); `GET /api/v1/artist/lookup?term=`; `GET /api/v1/artist` (added artists); `GET /api/v1/album?artistId=` (albums with `statistics.trackFileCount/totalTrackCount`, `monitored`, `grabbed`?); `GET /api/v1/album/lookup?term=`; add flow for a NOT-yet-added artist (POST `/api/v1/artist` with `addOptions` monitor none + qualityProfileId/metadataProfileId/rootFolderPath from `GET /api/v1/qualityprofile`, `/metadataprofile`, `/rootfolder`) then set the album monitored (`PUT /api/v1/album` or `POST /api/v1/album/monitor`) and `POST /api/v1/command {name: "AlbumSearch", albumIds:[...]}`; `GET /api/v1/queue` (progress: `size`, `sizeleft`, `status`, `trackedDownloadState`).

## Plugin API (additive)

```ts
export type AcquisitionState = "owned" | "downloaded" | "downloading" | "requested" | "available" | "unavailable";
export interface AcquirableAlbum {
  title: string; artistName: string; year?: number; imageUrl?: string;
  providerRef: string;            // opaque — pass back to acquireAlbum
  state: Exclude<AcquisitionState, "owned">;   // host adds "owned" by library cross-check
  detail?: string;                // e.g. "7/12 tracks", "no release found"
}
export interface AcquisitionStatusItem {
  title: string; artistName: string; state: AcquisitionState; progress?: number; // 0..1
  detail?: string;
}
export interface AcquisitionProvider {
  id: string;
  lookupArtistAlbums(artistName: string): Promise<AcquirableAlbum[]>; // [] = artist unknown to the provider
  acquireAlbum(providerRef: string): Promise<void>;
  status(): Promise<AcquisitionStatusItem[]>;
}
// PluginContext gains: registerAcquisitionProvider(p): Disposable
```

## Tasks

### Task 1: Extension point + host + IPC
- plugin-api types above + ctx/registry wiring (mirror SimilarProvider exactly).
- Host: `acquisitionAvailable(): boolean`; `lookupArtistAlbums(name)` — first registered provider with results wins (fan-out sequentially, isolation + timeout 15s — Lidarr lookups are slow); items returned tagged `{providerId}`; `acquireAlbum(providerId, providerRef)` routes to that provider (unknown → throw); `acquisitionStatus()` merges all providers (isolation).
- Owned cross-check in the IPC handler: `gateway.search(artistName)`-based — if artist matched in library, fetch its albums (cached listAlbums) and mark lookup items with matching titles `state: "owned"` + attach `{artistId, serverId, albumId}` so the renderer can navigate.
- IPC: `acquisitionAvailable`, `acquisitionLookupArtist(name) → AcquirableAlbumDto[]` (adds providerId + owned nav ids + externalArtUrl-baked imageUrl), `acquisitionAcquire({providerId, providerRef})`, `acquisitionStatus() → (AcquisitionStatusItem & {providerId})[]`. Preload + MusexApi.
- Host tests: fixture provider routing/merge/isolation (mirror getSimilar tests).
- Commit: `feat(plugins): AcquisitionProvider extension point — lookup, acquire, status`

### Task 2: Lidarr plugin (`plugins/lidarr/`, `@musex/plugin-lidarr`)
- Scaffold mirrors `plugins/lastfm` (package.json/tsconfig/vitest/build.mjs/plugin.json id `lidarr`, apiVersion 1).
- **Verify the API against the OpenAPI docs (WebFetch lidarr.audio/docs/api or the OpenAPI JSON) before coding the client.** `client.ts`: baseUrl (normalized, no trailing slash) + `X-Api-Key`; typed thin wrappers for the endpoints listed in the header; unit-test URL/path building + the album-state derivation logic with fixtures (pure function `deriveAlbumState(album, queueItems): {state, detail}`: downloaded = stats.trackFileCount >= totalTrackCount && >0; downloading = in queue; requested = monitored && not downloaded; available = !monitored/not added; unavailable = no releases/foreign data — verify which fields encode this).
- Settings: `baseUrl` (text), `apiKey` (password), `test` (action → system/status, shows version), `connection` (status), `qualityProfile`/`rootFolder` — v1: auto-pick the FIRST quality profile, metadata profile and root folder at add time (log the choice); a fancier picker needs new SettingField kinds — out of scope, note it.
- Provider impl: `lookupArtistAlbums`: artist/lookup → exact-ish name match (first result fallback) → if artist has Lidarr id: GET albums?artistId + queue → derive states; else albums from the artist-lookup payload/album-lookup → state "available" (or "unavailable" when the lookup yields nothing usable); imageUrl from Lidarr images (remoteUrl). `acquireAlbum(ref)`: ref = foreignAlbumId; ensure artist added (POST artist w/ monitor none + first profiles/rootfolder) → find/monitor the album → AlbumSearch command. `status()`: queue + monitored-but-missing albums → items with progress (1 - sizeleft/size).
- All calls per-call try/catch; not-configured → `lookupArtistAlbums` returns [] and `status` [] (silent), `acquireAlbum` throws "Lidarr is not configured".
- Commit: `feat(lidarr): Lidarr plugin — discography lookup, album acquisition, download status`

### Task 3: Renderer — External Artist view + Downloads view + click rerouting
- View union: `{ name: "external-artist"; artistName: string }` + `{ name: "downloads" }`.
- `ExternalArtistView`: header (artist name + "via Lidarr"-style provider note), tiled album grid (GridCard, square): state badge per album (`owned` → navigates to the library album; `downloaded` badge (already in Lidarr's files but maybe not yet in Plex — still badge it "downloaded"); `downloading` → progress-ish badge; `requested`; `available` → hover **Add** button (lucide `Download`) → `acquisitionAcquire` then optimistic flip to "requested" + toast; `unavailable` → dimmed card + "unavailable" badge). Loading/empty/error states ("Artist not found on Lidarr").
- `DownloadsView`: sidebar nav item "Downloads" (lucide `Download`, under Discover); lists `acquisitionStatus()` rows (title, artist, state chip, progress bar when downloading); auto-refresh every 10s while the view is open; empty state.
- Rerouting: `PluginSections` + `SimilarPanel` artist tiles: when the item is external AND `acquisitionAvailable()` (fetch once per mount, cheap) → `onOpen` navigates `{name:"external-artist", artistName: item.name}` instead of `openExternal`; keep `openExternal` fallback otherwise. ExternalArtistView also keeps a small "Open on last.fm"-style external link when the originating item had `externalUrl`? — skip v1 (the view stands alone).
- Badge CSS: extend `.grid-card-badge` with state variants (colors: downloaded green, downloading yellow, requested purple, unavailable red/dim).
- Commit: `feat(ui): External Artist discography view + Downloads status view (Lidarr-backed)`

**Manual acceptance:** configure Lidarr (URL+key, Test shows version) → Discover/Similar external artist click → discography with states → Add an album → appears in Downloads with progress → lands in Plex eventually; an artist Lidarr doesn't know shows the not-found state; albums without releases show "unavailable"; partially-owned artists show owned badges that navigate into the library.
