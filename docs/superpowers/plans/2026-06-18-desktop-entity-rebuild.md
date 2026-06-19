# Desktop Entity Rebuild (SP1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Rebuild the desktop entity experience on SP0 — unified artist + album pages (owned + unowned + acquisition inline, reached identically from everywhere via `resolveEntity`), Follow (= acquire + monitor) as the one acquisition action wired through `FollowService`, inline acquisition + a conditional activity pill + an Activity page, the side panel as context-only, and one card component with the SP0 badge vocabulary.

**Architecture:** Wire SP0's deferred ports in main (electron-store `FollowStore` + a `MonitorBackend` over the acquisition provider + `FollowService`, exposed via IPC); replace the renderer's `resolveEntityTarget`/monitoring store with `resolveEntity` + a `FollowProvider`; merge `ArtistDetailView`+`ExternalArtistView`→`ArtistView` and extend `AlbumDetailView`→`AlbumView`; route Similar/Search/Discover/cards through `resolveEntity`; add the activity pill + `ActivityView`; narrow `EntityPanel` to context-only. Spec: `docs/superpowers/specs/2026-06-18-desktop-entity-rebuild-design.md`.

**Tech Stack:** Electron 42 + React 19, TS 6 (`verbatimModuleSyntax`, two tsc passes — `tsconfig.node.json` main + `tsconfig.json` renderer), `@musex/core` (SP0), biome 2, vitest 4.

## Global Constraints

- **Consume SP0** — `resolveEntity`/`EntityRef`/ref constructors, `FollowService`/`FollowStore`/`MonitorBackend`, `tokens`/`ENTITY_STATE`/`entityState` — all from `@musex/core`. Don't reimplement.
- **Follow semantics:** `follow(artist)` → `MonitorBackend.follow` = `acquireArtistByName` (acquire discography + monitor); `unfollow(artist)` → stop watching new releases (acquired media kept — full un-acquire isn't supported, documented); `isFollowed(artist)` = monitored ∪ watched; `album`/`track` → local favorite (electron-store). UI says **Follow/Following** (retire Monitor/Watch). Secondary **"Get just this album"** → existing `acquireAlbum`.
- **Badges: non-default states only** (owned shows none). One card component everywhere; names always navigate via `resolveEntity`.
- **No new acquisition mechanics; no mobile; no cross-device sync.**
- **Verification:** full `pnpm check` (two desktop tsc passes + biome + tests) green before every commit; controller re-runs before push. `git add -A`. Renderer UI isn't unit-tested (per existing desktop convention) — the main adapters + any pure helpers ARE; UI correctness is the user's on-desktop acceptance + the adversarial review.
- Grounded shapes (the controller hands implementers the exact current code): the views, the View union, `entity-target.ts`, `monitoring.tsx`/`MonitorButton.tsx`, `GridCard`, `Shell`/`TopBar`, `Runtime`/`ipc.ts`/`ipc-contract.ts`/preload, `panel.tsx`/`EntityPanel`.

---

## Batch 1 — Main: wire FollowService + IPC (testable)

### Task 1: electron-store `FollowStore` adapter
**Files:** Create `packages/desktop/src/main/adapters/follow-store.ts` + `.test.ts`.
- Implement the SP0 `FollowStore` port over electron-store (a `follows` key holding `FollowRecord[]`): `init`/`list`/`add`/`remove`/`has`. Inject the store (a `{get,set}`) for testability.
- [ ] TDD: add→has→list→remove round-trip; dedup by `key`; survives reload (fake store). Commit `feat(desktop): electron-store FollowStore adapter`.

### Task 2: `MonitorBackend` adapter over the acquisition provider
**Files:** Create `packages/desktop/src/main/adapters/provider-monitor-backend.ts` + `.test.ts`.
- Implement the SP0 `MonitorBackend` over `rt.providers.getAcquisitionProvider()`: `follow(name)`→`provider.acquireArtistByName(name)`; `unfollow(name)`→`provider.watchNewReleases?.(name,false)` (stop watching; media kept); `isFollowed(name)`→`(await listMonitoredArtists ∪ listWatchedArtists).includes(name)`; `listFollowed()`→that union. Inject a provider-getter; no provider → `follow`/`unfollow` throw a friendly "no acquisition plugin", `isFollowed`→false, `listFollowed`→[].
- [ ] TDD (fake provider): follow→acquireArtistByName called; isFollowed reads the union; unfollow→watchNewReleases(false); no-provider paths. Commit `feat(desktop): MonitorBackend over the acquisition provider`.

### Task 3: construct `FollowService` in Runtime + IPC + preload
**Files:** Modify `runtime.ts` (construct `followStore`+`monitorBackend`+`followService`), `shared/ipc-contract.ts` (add channels + an `EntityRefDto`), `main/ipc.ts` (handlers), `preload/index.ts` (+ `MusexApi` type).
- `EntityRefDto` mirrors core `EntityRef` (JSON-safe). Channels: `follow:set` `(ref, value:boolean)`, `follow:get` `(ref)→boolean`, `follow:list` `(kind)→EntityRefDto[]`. Handlers call `rt.followService.follow/unfollow/isFollowed/listFollowed` (map DTO↔`EntityRef`). Keep the existing acquisition/watch IPC (the `MonitorBackend` uses those provider methods).
- [ ] Add the channels + handlers + preload; `pnpm check` (both tsc passes) green. Commit `feat(desktop): FollowService + follow IPC`.

---

## Batch 2 — Renderer: nav + follow + card foundation

### Task 4: `resolveEntity` nav (replace `resolveEntityTarget`/`EntityLink`/`useEntityNav`)
**Files:** Modify `state/app.tsx` (View union: **remove** `external-artist`; rename `acquiring`→`activity`; the `artist` case payload becomes an `EntityRef` — `{ name:"artist"; ref: EntityRef }` — same for `album` `{ name:"album"; ref: EntityRef }`), `discovery/entity-target.ts` → re-implement `EntityLink`/`useEntityNav` over SP0 `resolveEntity` (`resolveEntity(ref).nav` → a `View`); update `Shell.tsx` routing + every `dispatch({type:"navigate",view:{name:"artist"|"album",...}})` + `{name:"external-artist"}` caller to emit an `EntityRef` (use `entityRefForArtist/Album` / `externalArtistRef`).
- Map `NavTarget` → `View`: `{kind:"artist",ref}`→`{name:"artist",ref}`; `{kind:"album",ref}`→`{name:"album",ref}`; `{kind:"track",ref}`→navigate to the track's album (`externalAlbumRef`/the album ref) — tracks have no page.
- [ ] `pnpm check` green (the views still take the old props until Batch 3 — keep a temporary adapter: `ArtistDetailView`/`AlbumDetailView` accept `ref` and internally derive the old `Artist`/`Album` for now, OR do Batch 3 in the same task if cleaner). Commit `refactor(desktop): entity navigation via core resolveEntity`.

### Task 5: `FollowProvider` (replace the monitoring store)
**Files:** Modify `state/monitoring.tsx` → `state/follow.tsx` (`FollowProvider`/`useFollow`), `discovery/MonitorButton.tsx` → a `FollowButton` using `useFollow`.
- `useFollow`: `isFollowed(ref)` (cached; seeded from `follow:list` for artists + favorites), `setFollowed(ref, value)` (optimistic → `follow:set` IPC, revert on error), `following(kind)` list. The `FollowButton` renders "♥ Following" / "Follow", busy state; for an unowned artist the label hints "Follow (acquire + watch)".
- [ ] `pnpm check` green. Commit `feat(desktop): FollowProvider + FollowButton (replaces monitoring store)`.

### Task 6: one card component + SP0 badge vocabulary
**Files:** Modify `GridCard.tsx` (+ a small `EntityBadge` from `ENTITY_STATE`).
- `GridCard` takes an `EntityRef` (or the state inputs) + computes `entityState(resolveEntity(ref), {downloaded,downloading,following,acquiring})`; renders the badge **only for non-default states** (color/icon from `ENTITY_STATE`, lucide icon via the renderer allowlist), the hover action = Play (owned) / Follow (unowned), a ⋯ secondary menu (Follow, Get just this album [albums], Play next, …), and the name → `resolveEntity` nav. Remove the ad-hoc `monitored`/`state`/`badgeVariant` props in favor of the vocabulary.
- [ ] `pnpm check` green. Commit `feat(desktop): unified card + SP0 entity-state badges`.

---

## Batch 3 — Unified entity pages

### Task 7: `ArtistView` (merge owned + unowned)
**Files:** Create `views/ArtistView.tsx` (merging `ArtistDetailView` + `ExternalArtistView`); delete `ExternalArtistView.tsx`; update `Shell` routing.
- Props: `{ ref: EntityRef }` (artist, owned or external). Resolve ownership via `resolveEntity` + the owned cross-check. Fetch: owned → `listAlbums`; external/partly-owned → `acquisitionDiscography` (∪ owned). Header: art, name, status (entity-state), **FollowButton** (headline), Play/Shuffle when owned, genres/stats. **Discography** = one mixed list (release order) with status badges (no per-album Get button); click album → `{name:"album",ref}`. **Similar rail** = items via `resolveEntity` → unified pages (owned + unowned). **About** (last.fm bio) inline. last.fm/provider gating offline.
- [ ] `pnpm check` green. Commit `feat(desktop): unified ArtistView (owned + unowned + acquisition inline)`.

### Task 8: `AlbumView` (owned + unowned)
**Files:** Rename/extend `AlbumDetailView.tsx` → `views/AlbumView.tsx`; update routing.
- Props: `{ ref: EntityRef }`. Owned: track list (VirtualTrackList) + per-track downloaded/cached availability + ♥ favorite (FollowButton on album) + Play/Shuffle/Download. Unowned: last.fm track list (display-only) + **Follow [artist]** primary + a **Get just this album** secondary (⋯ → `acquireAlbum`). Artist breadcrumb via `resolveEntity` (use the track's `artistId`; fixes the compilation dead-end).
- [ ] `pnpm check` green. Commit `feat(desktop): unified AlbumView (owned + unowned)`.

---

## Batch 4 — Flow surfaces + consistency sweep

### Task 9: Activity pill + `ActivityView` + sidebar entry
**Files:** Modify `TopBar.tsx` (conditional activity pill + popover), rename `AcquiringView.tsx`→`ActivityView.tsx` (+ Shell routing `activity`), `Shell.tsx` sidebar (add persistent **Activity** entry; keep On-this-device).
- The pill subscribes to the acquisition status/progress feed (the existing download/acquisition progress sink + `acquisitionMonitoredArtists`); **visible iff in-flight count > 0**; popover lists in-flight items + progress + "View all"→`activity`. `ActivityView` = the full feed (in-flight + history + **Followed artists** [renamed from Watching] + the expansion feed it already shows).
- [ ] `pnpm check` green. Commit `feat(desktop): acquisition activity pill + Activity view`.

### Task 10: route Similar / Search / Discover / PluginSections through the unified model
**Files:** Modify `views/SimilarView.tsx`, `views/SearchView.tsx`, `views/DiscoverView.tsx`, `ui/PluginSections.tsx`.
- All entity items → the unified card (Task 6) + `resolveEntity` nav. **Remove the "open a panel for an unowned artist" behavior** — unowned cards navigate to the unified `ArtistView` like everything else. Search keeps "in your library" + "not in your library" sections, both using the unified card. SimilarView items (owned + unowned) → unified pages (no external-URL/external-view divergence).
- [ ] `pnpm check` green. Commit `refactor(desktop): Similar/Search/Discover use the unified entity model`.

### Task 11: `EntityPanel` → context-only
**Files:** Modify `state/panel.tsx`, `ui/discovery/EntityPanel.tsx`, `discovery/panel-focus.ts`, callers of `openEntity`/`openArtistInfo`.
- The panel is now-playing + track-detail context only. Remove `openArtistInfo`/artist-as-pinned-entity entry points that competed with navigation; the panel's artist/album/song links become `resolveEntity` navigation (→ unified pages), and `derivePanelFocus` drops the "current view is artist/album" branch (the page IS the context now) — keep selected-track + now-playing. The "Info" button on entity pages either opens the now-playing/track panel for a selected track or is removed (the page already shows the info).
- [ ] `pnpm check` green. Commit `refactor(desktop): EntityPanel is now-playing/track-detail context only`.

---

## Batch 5 — Verify, review, docs

### Task 12: full verification + adversarial review + docs
- [ ] Controller full `pnpm check` (both tsc passes + biome + tests) exit 0.
- [ ] Adversarial review over the whole diff: every entity entry point lands on the unified page (no dead text, no external-view, no panel-as-destination); Follow wiring (acquire+monitor; isFollowed seeds correctly; unfollow=stop-watching); the activity pill only-while-in-flight + correct feed; badge density (non-default only) + lucide-icon allowlist; no swallowed errors; offline gating; the View-union migration (no leftover `external-artist`/`acquiring` refs); breadcrumb fix. Fix confirmed findings.
- [ ] Update root `CLAUDE.md` (the SP1 arc bullet: unified ArtistView/AlbumView via resolveEntity; FollowService wiring [FollowStore electron-store + MonitorBackend over the provider + follow IPC]; Follow=acquire+monitor + per-album Get; activity pill + ActivityView; panel context-only; unified card + non-default badges; the View-union changes).
- [ ] Commit; controller re-runs `pnpm check`; push; finalize PR with on-desktop test steps (navigate similar→discover→artist→Follow→watch the pill; owned/unowned artist+album pages; consistent cards everywhere; panel context-only).

---

## Testing summary
- **Unit (TDD):** `FollowStore` (electron-store, fake), `MonitorBackend` (fake provider), any new renderer-pure helper. SP0's `resolveEntity`/`FollowService`/`entityState` already tested in core.
- **Not unit-tested (per desktop convention):** renderer views — gated by `pnpm check` + the adversarial review + the user's on-desktop acceptance.

## Risks
- **View-union migration (Task 4):** changing `artist`/`album` payloads to `EntityRef` + removing `external-artist` touches every navigate call — a temporary prop-adapter on the views keeps `pnpm check` green until Batch 3 merges them. Verify no stray `external-artist`/`acquiring` references remain.
- **Follow state seeding:** `isFollowed(artist)` must reflect the provider's monitored∪watched at load (seed from `follow:list`) so buttons aren't wrong after navigation.
- **Activity pill feed:** reuse the existing progress sink; don't invent a new acquisition status channel — confirm the feed exposes in-flight count + per-item progress.
