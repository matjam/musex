# Entity + Follow Foundation (SP0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the pure `@musex/core` foundation for the entity-consistency overhaul — a source-agnostic `EntityRef` + `resolveEntity`, a `FollowService` facade (+ `FollowStore`/`MonitorBackend` ports + fakes), and shared design tokens + an entity-state badge vocabulary — with no UI and no platform adapters.

**Architecture:** All additive, pure `@musex/core`. Spec: `docs/superpowers/specs/2026-06-18-entity-follow-foundation-design.md`. Desktop (SP1) + mobile (SP2) consume these later.

**Tech Stack:** TypeScript 6 (`verbatimModuleSyntax`, no Node/DOM in core), vitest 4, biome 2.

## Global Constraints

- **Pure core only** — no Node/DOM/RN imports; values only in `design/`. `import type` for types.
- **Follow semantics:** `follow(artist)` → `MonitorBackend.follow(name)` (acquire full discography + monitor) **and** local record; no backend → local wishlist; `album`/`track` → local favorite. `unfollow` mirrors. `isFollowed(artist)` = `monitor?.isFollowed ∪ store.has`. UI term is "Follow/Following" (no "Monitor").
- **Local per-device** storage via the `FollowStore` port (adapters are SP1/SP2, NOT here).
- **No UI, no platform adapters.** `pnpm check` green before every commit; `git add -A`.
- Palette to extract verbatim (desktop `ui/theme.css` `:root`): bg `#0d0e12`, panel `#16181f`, panel2 `#21242d`, sidebar `#0a0b0e`, text `#e7e9ee`, muted `rgba(231,233,238,0.5)`, line `rgba(255,255,255,0.07)`, green `#54d2a0`, purple `#7c5cff`, red `#ff5f57`, yellow `#febc2e`.

---

## File structure (all new, `packages/core/src/`)
- `models/entity-ref.ts` — `EntityRef`/`EntityKind`/`EntitySource` + ref constructors.
- `logic/entity-ref.ts` (+ `.test.ts`) — `followKey`, `resolveEntity`, `NavTarget`, `ResolvedEntity`.
- `ports/follow-store.ts` — `FollowStore` + `FollowRecord`.
- `ports/monitor-backend.ts` — `MonitorBackend`.
- `logic/follow-service.ts` (+ `.test.ts`) — `FollowService`.
- `design/tokens.ts` — `colors`/`space`/`radius`/`type`.
- `design/entity-state.ts` (+ `.test.ts`) — `EntityState`, `ENTITY_STATE` map, `entityState()`.
- `testing/fakes.ts` (modify) — `FakeFollowStore`, `FakeMonitorBackend`.
- `index.ts` (modify) — barrel exports.

---

### Task 1: `EntityRef` model + constructors + `followKey`

**Files:** Create `models/entity-ref.ts`, `logic/entity-ref.ts` (followKey part) + `logic/entity-ref.test.ts`; Modify `index.ts`.

**Interfaces produced:**
```ts
// models/entity-ref.ts
export type EntityKind = "artist" | "album" | "track";
export type EntitySource = "plex" | "external";
export interface EntityRef {
  kind: EntityKind; source: EntitySource;
  id?: string; serverId?: string;
  name: string; artistName?: string; albumTitle?: string; thumb?: string;
}
export function entityRefForArtist(a: Artist): EntityRef;   // {kind:"artist",source:"plex",id:a.id,serverId,name:a.name,thumb}
export function entityRefForAlbum(a: Album): EntityRef;      // {kind:"album",source:"plex",id,serverId,name:a.title,albumTitle:a.title,thumb}
export function entityRefForTrack(t: Track): EntityRef;      // {kind:"track",source:"plex",id,serverId,name:t.title,artistName,albumTitle,thumb}
export function externalArtistRef(name: string): EntityRef;  // {kind:"artist",source:"external",name}
export function externalAlbumRef(title: string, artistName: string): EntityRef;
// logic/entity-ref.ts
export function followKey(ref: EntityRef): string;
```
`followKey`: `source==="plex"` → `${kind}:plex:${id}`; external → `${kind}:external:${[artistName, name].filter(Boolean).map(s=>s.trim().toLowerCase()).join("␟")}`.

- [ ] **Step 1:** Failing test in `logic/entity-ref.test.ts`: `followKey(entityRefForArtist({id:"a1",...}))` === `"artist:plex:a1"`; `followKey(externalArtistRef("Radiohead"))` === `"artist:external:radiohead"`; `followKey(externalAlbumRef("OK Computer","Radiohead"))` === `"album:external:radiohead␟ok computer"`; constructors map the model fields correctly (e.g. `entityRefForAlbum` sets `name` to the album title + `source:"plex"`).
- [ ] **Step 2:** Run → fail. **Step 3:** Implement `models/entity-ref.ts` + `followKey` in `logic/entity-ref.ts`. **Step 4:** Run → pass.
- [ ] **Step 5:** Barrel-export both from `index.ts`. `pnpm --filter @musex/core test` + typecheck. Commit `feat(core): EntityRef model + followKey`.

### Task 2: `resolveEntity` + affordances + `NavTarget`

**Files:** Modify `logic/entity-ref.ts` + `logic/entity-ref.test.ts`; `index.ts`.

**Interfaces produced:**
```ts
export type NavTarget = { kind: EntityKind; ref: EntityRef };
export interface ResolvedEntity {
  ref: EntityRef; nav: NavTarget;
  affordances: { playable: boolean; followable: boolean; acquirable: boolean; hasExternalInfo: boolean };
}
export function resolveEntity(ref: EntityRef): ResolvedEntity;
```
Rules: `nav = { kind: ref.kind, ref }` (every entity navigates to its own page). `playable = ref.source === "plex"`. `followable = true`. `acquirable = ref.source === "external" && (ref.kind === "artist" || ref.kind === "album")`. `hasExternalInfo = ref.kind === "artist"`.

- [ ] **Step 1:** Failing test: owned artist → `{playable:true, acquirable:false, followable:true, hasExternalInfo:true}` + `nav.kind==="artist"`; external artist → `{playable:false, acquirable:true, followable:true, hasExternalInfo:true}`; owned album → `playable:true,acquirable:false`; external album → `acquirable:true`; external track → `acquirable:false` (Lidarr is album-level).
- [ ] **Step 2:** Run → fail. **Step 3:** Implement `resolveEntity`. **Step 4:** Run → pass.
- [ ] **Step 5:** Barrel-export. `pnpm --filter @musex/core test`. Commit `feat(core): resolveEntity (source-agnostic nav + affordances)`.

### Task 3: `FollowStore` + `MonitorBackend` ports + fakes

**Files:** Create `ports/follow-store.ts`, `ports/monitor-backend.ts`; Modify `testing/fakes.ts`, `index.ts`.

**Interfaces produced:**
```ts
// ports/follow-store.ts
export interface FollowRecord { key: string; kind: EntityKind; ref: EntityRef; followedAt: number; }
export interface FollowStore {
  init(): Promise<void>; list(): Promise<FollowRecord[]>;
  add(rec: FollowRecord): Promise<void>; remove(key: string): Promise<void>; has(key: string): Promise<boolean>;
}
// ports/monitor-backend.ts
export interface MonitorBackend {
  follow(artistName: string): Promise<void>;   // acquire full discography + monitor
  unfollow(artistName: string): Promise<void>;
  isFollowed(artistName: string): Promise<boolean>;
  listFollowed(): Promise<string[]>;
}
```
`FakeFollowStore` (in-memory `Map<key,FollowRecord>`) + `FakeMonitorBackend` (in-memory `Set<string>` of artist names; records follow/unfollow calls for assertions).

- [ ] **Step 1:** Write the ports + the two fakes (fakes are test infra — a trivial round-trip test in `fakes` is optional; the real coverage is Task 4).
- [ ] **Step 2:** Barrel-export the ports + fakes. `pnpm --filter @musex/core typecheck` + test. Commit `feat(core): FollowStore + MonitorBackend ports + fakes`.

### Task 4: `FollowService` facade

**Files:** Create `logic/follow-service.ts` + `logic/follow-service.test.ts`; `index.ts`.

**Interfaces produced:**
```ts
export interface FollowServiceDeps { store: FollowStore; monitor?: MonitorBackend; now?: () => number; }
export class FollowService {
  constructor(deps: FollowServiceDeps);
  follow(ref: EntityRef): Promise<void>;
  unfollow(ref: EntityRef): Promise<void>;
  isFollowed(ref: EntityRef): Promise<boolean>;
  listFollowed(kind: EntityKind): Promise<EntityRef[]>;
}
```
`follow`: `kind==="artist" && monitor` → `await monitor.follow(ref.name)` then `store.add(rec)`; `kind==="artist" && !monitor` → `store.add(rec)`; album/track → `store.add(rec)`. `rec = { key: followKey(ref), kind: ref.kind, ref, followedAt: (now ?? Date-injected)() }` — inject `now` (default a passed fn; tests pass a fixed one; core has no `Date.now` ban issue here since it's injected). `unfollow`: artist+monitor → `monitor.unfollow(ref.name)` + `store.remove(key)`; else `store.remove(key)`. `isFollowed`: artist → `(monitor ? await monitor.isFollowed(ref.name) : false) || store.has(followKey(ref))`; else `store.has(...)`. `listFollowed(kind)`: `store.list()` filtered by kind → refs; for `kind==="artist"` also merge `monitor?.listFollowed()` as `externalArtistRef(name)` deduped by `followKey`.

- [ ] **Step 1:** Failing tests (FakeFollowStore + FakeMonitorBackend, fixed `now`): `follow(externalArtistRef("X"))` with monitor → `monitor.follow("X")` called + store has the record; `follow` artist with NO monitor → only store; `follow(album)` → store only, monitor untouched; `isFollowed(artist)` true when monitor says so even if not in store; `unfollow(artist)` with monitor → `monitor.unfollow` + store removed; `listFollowed("artist")` merges + dedups store + monitor (no duplicate when both have it).
- [ ] **Step 2:** Run → fail. **Step 3:** Implement `FollowService`. **Step 4:** Run → pass.
- [ ] **Step 5:** Barrel-export. `pnpm --filter @musex/core test`. Commit `feat(core): FollowService facade`.

### Task 5: Design tokens + entity-state vocabulary

**Files:** Create `design/tokens.ts`, `design/entity-state.ts` + `design/entity-state.test.ts`; `index.ts`.

**Interfaces produced:**
```ts
// design/tokens.ts (values only — the verbatim palette + scales)
export const colors = { bg:"#0d0e12", panel:"#16181f", panel2:"#21242d", sidebar:"#0a0b0e", text:"#e7e9ee", muted:"rgba(231,233,238,0.5)", line:"rgba(255,255,255,0.07)", green:"#54d2a0", purple:"#7c5cff", red:"#ff5f57", yellow:"#febc2e" } as const;
export const space = { xs:4, sm:8, md:12, lg:16, xl:24, xxl:32 } as const;
export const radius = { sm:6, md:10, lg:16, pill:999 } as const;
export const type = { caption:12, body:14, subtitle:16, title:20, hero:28 } as const;
// design/entity-state.ts
export type EntityState = "owned"|"unowned"|"downloaded"|"downloading"|"following"|"acquiring"|"available"|"unavailable";
export const ENTITY_STATE: Record<EntityState, { label: string; colorToken: keyof typeof colors; icon: string }>;
export function entityState(resolved: ResolvedEntity, flags: { downloaded?: boolean; downloading?: boolean; following?: boolean; acquiring?: boolean; unavailable?: boolean }): EntityState;
```
`ENTITY_STATE` (icon = lucide name): owned→{"In library","green","library"}, unowned→{"Not in library","muted","circle-dashed"}, downloaded→{"Downloaded","green","hard-drive-download"}, downloading→{"Downloading","yellow","loader"}, following→{"Following","purple","heart"}, acquiring→{"Acquiring","yellow","download"}, available→{"Available","text","plus"}, unavailable→{"Unavailable","muted","ban"}. `entityState` precedence: `downloading` → `acquiring` → `downloaded` → `following` → (`flags.unavailable` && external → `unavailable`) → (`resolved.ref.source==="plex"` → `owned`) → (`resolved.affordances.acquirable` → `available`) → `unowned`.

- [ ] **Step 1:** Failing test: `colors.green === "#54d2a0"`; every `EntityState` key has an `ENTITY_STATE` entry whose `colorToken` is a real `colors` key; `entityState(resolveEntity(ownedArtist), {})` === `"owned"`; `…(externalArtist, {})` === `"available"`; `{downloading:true}` wins over `{downloaded:true}`; `{following:true}` over owned.
- [ ] **Step 2:** Run → fail. **Step 3:** Implement both files. **Step 4:** Run → pass.
- [ ] **Step 5:** Barrel-export (`export * from "./design/tokens"` + `./design/entity-state`). `pnpm check` (full). Commit `feat(core): shared design tokens + entity-state vocabulary`.

### Task 6: Final verification

- [ ] **Step 1:** Controller runs full `pnpm check` (core + plugin-host + desktop ×2 + mobile + biome + all tests) → exit 0; confirm core gained the new tests + nothing else regressed (pure additive). Commit nothing new unless a barrel/typecheck fix is needed.

---

## Testing summary
Pure-core unit tests: `followKey`/constructors, `resolveEntity` affordances, `FollowService` routing/merge/unfollow (fakes), tokens/vocabulary shape + `entityState` precedence. No platform code, no UI. `pnpm check` green.

## Self-review notes
- Spec coverage: Follow model/facade/ports (T3,T4) ✓; EntityRef + resolver (T1,T2) ✓; tokens + vocabulary (T5) ✓; fakes (T3) ✓; no UI/adapters ✓. 
- Type consistency: `EntityRef`/`followKey`/`ResolvedEntity`/`FollowRecord`/`FollowServiceDeps` used consistently across tasks.
- `now` injected into `FollowService` (no `Date.now` in core).
