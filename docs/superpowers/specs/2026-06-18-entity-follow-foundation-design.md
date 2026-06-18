# Entity + Follow Foundation (SP0) Design

**Date:** 2026-06-18
**Status:** Approved (design); proceeding to plan + build.
**Context:** First piece of a UI-consistency overhaul (the "polish + source-agnostic entity navigation" arc). The desktop app navigates entities inconsistently (an unowned artist opens a side panel from Discover, a full view from Similar, or dead text elsewhere; acquisition is inline in some places and a page in others); the mobile app is consistent but shallow (unowned/last.fm artists are silently dropped, no follow concept). Rather than fix each app's UI ad hoc, this **shared foundation** establishes — in `@musex/core` + shared design tokens, with **no UI** — the three things both apps' entity UIs will rebuild on: the **Follow** model, a **source-agnostic entity reference + resolver**, and the **design tokens + entity-state vocabulary**. Desktop (SP1) and mobile (SP2) are separate follow-on specs that consume this.

## Decisions locked in brainstorming

- **Foundation-first** (this spec), then desktop (SP1), then mobile (SP2).
- **"Follow" replaces "Monitor/Watch"** in the product vocabulary. `follow(artist)` on desktop = the acquisition provider (Lidarr) **acquires the full discography + monitors** (the existing `acquireArtist`: add + monitor + search-for-missing); `unfollow(artist)` stops monitoring (keeps already-acquired media); `isFollowed(artist)` = the provider's monitored state. `follow(album/track)` = a local favorite. Mobile (no acquisition) = a local artist **wishlist** + album/track favorites.
- **Follow/favorite storage is local per-device** (a core port; electron-store on desktop, async-storage on mobile) — matches the taste profile + downloads index. No cross-device sync (artist-follow still syncs where it maps to Lidarr's server-side monitored state).
- **No UI in SP0.**

## Architecture (three pure-core units + tokens)

### 1. Follow model + `FollowService` facade

- **`EntityRef`** (see unit 2) is the currency: a follow targets an `EntityRef`.
- **`FollowStore` port** (`ports/follow-store.ts`): per-device persistence — `init()` · `list(): FollowRecord[]` · `add(rec)` · `remove(key)` · `has(key)`. `FollowRecord = { key: string; kind: "artist"|"album"|"track"; ref: EntityRef; followedAt: number }`; `key = followKey(ref)` (stable: `kind:source:id` for owned, `kind:external:lowercased-name` for unowned). Holds album/track favorites, the mobile artist wishlist, and any desktop artist-follow with no provider.
- **`MonitorBackend` port** (`ports/monitor-backend.ts`): the artist-acquisition capability — `follow(artistName): Promise<void>` (= acquire full discography + monitor) · `unfollow(artistName): Promise<void>` (unmonitor) · `isFollowed(artistName): Promise<boolean>` · `listFollowed(): Promise<string[]>`. Desktop's adapter (SP1) wraps the existing acquisition provider (`acquireArtistByName` / `listMonitoredArtists` / the unmonitor path); mobile passes **none**.
- **`FollowService`** (`logic/follow-service.ts`) — the unified facade injected with `{ store: FollowStore; monitor?: MonitorBackend }`:
  - `follow(ref)`: **artist** + `monitor` present → `monitor.follow(ref.name)` (acquire+monitor) **and** record locally (so unowned-followed is reflected even before Lidarr confirms); **artist** + no `monitor` → local wishlist record; **album/track** → local favorite record.
  - `unfollow(ref)`: artist + `monitor` → `monitor.unfollow(ref.name)` + remove local; else remove local.
  - `isFollowed(ref): Promise<boolean>`: artist → `(monitor?.isFollowed(name)) || store.has(key)`; album/track → `store.has(key)`.
  - `listFollowed(kind): Promise<EntityRef[]>` — merge local + (artist) provider-monitored (deduped by key).
- Pure routing + the `FollowRecord`/key logic are core-tested against a fake `FollowStore` + a fake `MonitorBackend` (artist routes to backend + local; album/track local-only; no-backend artist → wishlist; merge/dedup; unfollow paths).

### 2. Source-agnostic entity reference + resolver

- **`EntityRef`** (`models/entity-ref.ts`): `{ kind: "artist"|"album"|"track"; source: "plex"|"external"; id?: string; serverId?: string; name: string; artistName?: string; albumTitle?: string; thumb?: string }`. Owned = `source:"plex"` with `id`; unowned/last.fm-only = `source:"external"`, name-based.
- Constructors from the existing models — `entityRefForArtist(Artist)`, `…Album(Album)`, `…Track(Track)`, and `externalArtistRef(name)` / `externalAlbumRef(title, artistName)` — so every entry point (search, similar, discover, a track's artist link, a home card) emits an `EntityRef` the same way.
- **`resolveEntity(ref): ResolvedEntity`** (`logic/entity-ref.ts`, pure) → `{ ref; nav: NavTarget; affordances: { playable: boolean; followable: boolean; acquirable: boolean; hasExternalInfo: boolean }; state: EntityState }`. `NavTarget` is a platform-agnostic descriptor (`{ kind, ref }`) each app maps to its own router/view. This unifies desktop's scattered `resolveEntityTarget` / `SectionItemDto.external` / `EntityLink` dead-end logic into one tested function: an artist resolves to the same artist target + the same affordance set regardless of how you got there.
- Tested: owned vs external × artist/album/track → correct nav + affordances (e.g. external artist → followable+acquirable+hasExternalInfo, not directly playable; owned album → playable+followable).

### 3. Design tokens + entity-state vocabulary

- **`design/tokens.ts`** — the shared source-of-truth values: the brand palette (extracted from desktop's existing `:root` CSS vars so nothing visual regresses), spacing scale, radii, and the type scale, as plain TS constants (core stays pure — values only, no DOM/RN). Desktop derives its CSS custom properties from these; mobile derives a theme object. (Generators/consumption wiring land in SP1/SP2; SP0 establishes the values.)
- **`design/entity-state.ts`** — the **entity-state vocabulary** as a shared enum + mapping: `owned · unowned · downloaded · downloading · following · acquiring · available · unavailable` → each maps to `{ label: string; colorToken: keyof tokens.colors; icon: string /* lucide name */ }`. Both apps render identical badges from this single table. A pure `entityState(resolved, { downloaded?, downloading?, following?, acquiring? })` helper computes the current display state.
- Tokens + vocabulary are refined as SP1/SP2 build the real UI — SP0 establishes the source of truth + the known palette, not a from-scratch design system.

## Components / files (all `@musex/core`, barrel-exported)

- `models/entity-ref.ts` — `EntityRef` + ref constructors.
- `ports/follow-store.ts` — `FollowStore` port + `FollowRecord`.
- `ports/monitor-backend.ts` — `MonitorBackend` port.
- `logic/entity-ref.ts` (+ test) — `resolveEntity` / `NavTarget` / affordances / `followKey`.
- `logic/follow-service.ts` (+ test) — `FollowService`.
- `design/tokens.ts`, `design/entity-state.ts` (+ test) — tokens + the state vocabulary + `entityState()`.
- `testing/fakes.ts` — add `FakeFollowStore` + `FakeMonitorBackend`.
- `index.ts` — barrel exports.

## Testing

All pure → unit-tested in core against fakes: `FollowService` routing/merge/unfollow (fake store + fake monitor), `resolveEntity` per source×kind, `followKey` stability, `entityState()` precedence, and the tokens/vocabulary shape (every state maps to a real color token + icon). No platform code, no UI.

## Non-goals (SP0)

- **No UI** — desktop entity-page rebuild is SP1; mobile is SP2.
- **No platform adapters** — the `FollowStore` (electron-store / async-storage) + the desktop `MonitorBackend` (over the acquisition provider) land in SP1/SP2 when the apps wire `FollowService`. SP0 ships the ports + the pure facade.
- **No cross-device sync** (local per-device; artist-follow syncs via Lidarr where applicable).
- **No new acquisition mechanics** — `MonitorBackend` reuses the existing `acquireArtist`/monitor capability.
- **No from-scratch design system** — extract + name the existing palette + the state vocabulary; refine during SP1/SP2.

## Success criteria

- `@musex/core` exports `EntityRef` + `resolveEntity` (source-agnostic nav + affordances), the `FollowStore`/`MonitorBackend` ports + the `FollowService` facade (with the locked follow semantics), and the shared `tokens` + entity-state vocabulary — all unit-tested.
- No behavior change anywhere yet (pure additive core); `pnpm check` green.
- SP1 (desktop) + SP2 (mobile) can build their entity UIs entirely on these primitives.
