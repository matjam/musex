# Library Staleness Fix (Plex Change Detection + Refresh) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** musex notices Plex library changes (websocket push + poll fallback), evicts its list cache, and refreshes the renderer — new artists/albums/tracks appear within seconds, no restart.

**Architecture:** Pure decision logic in new `logic/library-watch.ts` (notification parsing, change coalescing, reconnect backoff); a thin `main/adapters/library-watcher.ts` owns the global-`WebSocket` connection and timers (Node 24 in Electron main — verified, no new dependency); `Runtime` wires the refresh pipeline (cache evict → persist fresh Library → push `musex:library:changed`); the renderer replaces its `library` state object and every existing view refetches via its `library` useEffect dependency.

**Tech Stack:** TypeScript, Electron main (global WebSocket), vitest, existing `@ctrl/plex` gateway + `ListCacheStore` + typed IPC. Spec: `docs/superpowers/specs/2026-06-11-library-staleness-design.md`.

**Conventions for every task:** repo root `/Users/matjam/src/musex`; branch `fix/library-staleness`; main/logic/shared/preload imports use `.js` extensions, renderer imports use none; `pnpm check` must exit 0 before each commit (`pnpm exec biome check --write .` auto-fixes); commit with `git add -A` (never selective) and `git push` immediately after.

---

### Task 1: Pure logic — notification parsing, coalescer, backoff

**Files:**
- Create: `packages/desktop/src/logic/library-watch.ts`
- Test: `packages/desktop/src/logic/library-watch.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/desktop/src/logic/library-watch.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  ChangeCoalescer,
  nextReconnectDelayMs,
  relevantSectionChange,
  timestampChanged,
} from "./library-watch";

function timelineMsg(entries: Array<Record<string, unknown>>): unknown {
  return { NotificationContainer: { type: "timeline", size: entries.length, TimelineEntry: entries } };
}
const ENTRY = {
  identifier: "com.plexapp.plugins.library",
  sectionID: "3",
  itemID: "999",
  type: 10,
  title: "New Track",
  state: 5,
  updatedAt: 1760000000,
};

describe("relevantSectionChange", () => {
  it("matches a processed item in our section", () => {
    expect(relevantSectionChange(timelineMsg([ENTRY]), "3")).toBe(true);
  });

  it("matches a deleted item (state 9)", () => {
    expect(relevantSectionChange(timelineMsg([{ ...ENTRY, state: 9 }]), "3")).toBe(true);
  });

  it("numeric sectionID still matches (Plex is inconsistent about types)", () => {
    expect(relevantSectionChange(timelineMsg([{ ...ENTRY, sectionID: 3 }]), "3")).toBe(true);
  });

  it("ignores other sections", () => {
    expect(relevantSectionChange(timelineMsg([ENTRY]), "7")).toBe(false);
  });

  it("ignores in-progress states 0-4", () => {
    for (const state of [0, 1, 2, 3, 4]) {
      expect(relevantSectionChange(timelineMsg([{ ...ENTRY, state }]), "3")).toBe(false);
    }
  });

  it("ignores non-library identifiers", () => {
    expect(
      relevantSectionChange(timelineMsg([{ ...ENTRY, identifier: "com.plexapp.system" }]), "3"),
    ).toBe(false);
  });

  it("ignores non-timeline notifications", () => {
    expect(
      relevantSectionChange(
        { NotificationContainer: { type: "playing", PlaySessionStateNotification: [] } },
        "3",
      ),
    ).toBe(false);
    expect(
      relevantSectionChange(
        { NotificationContainer: { type: "activity", ActivityNotification: [] } },
        "3",
      ),
    ).toBe(false);
  });

  it("tolerates malformed payloads", () => {
    expect(relevantSectionChange(null, "3")).toBe(false);
    expect(relevantSectionChange("garbage", "3")).toBe(false);
    expect(relevantSectionChange({}, "3")).toBe(false);
    expect(relevantSectionChange({ NotificationContainer: { type: "timeline" } }, "3")).toBe(false);
  });
});

describe("timestampChanged", () => {
  it("any inequality counts (a reset Plex DB must register too)", () => {
    expect(timestampChanged(100, 200)).toBe(true);
    expect(timestampChanged(200, 100)).toBe(true);
    expect(timestampChanged(100, 100)).toBe(false);
  });

  it("missing fresh value is not a change; missing prev with a fresh value is", () => {
    expect(timestampChanged(100, undefined)).toBe(false);
    expect(timestampChanged(undefined, 100)).toBe(true);
    expect(timestampChanged(undefined, undefined)).toBe(false);
  });
});

describe("nextReconnectDelayMs", () => {
  it("caps an exponential curve at 60s", () => {
    expect(nextReconnectDelayMs(0)).toBe(1_000);
    expect(nextReconnectDelayMs(1)).toBe(2_000);
    expect(nextReconnectDelayMs(2)).toBe(4_000);
    expect(nextReconnectDelayMs(5)).toBe(32_000);
    expect(nextReconnectDelayMs(6)).toBe(60_000);
    expect(nextReconnectDelayMs(50)).toBe(60_000);
  });
});

describe("ChangeCoalescer", () => {
  it("a lone change is due after the quiet period", () => {
    const c = new ChangeCoalescer(5_000, 30_000);
    expect(c.noteChange(1_000)).toBe(6_000);
  });

  it("further changes push the due time out (re-armed quiet period)", () => {
    const c = new ChangeCoalescer(5_000, 30_000);
    c.noteChange(1_000);
    expect(c.noteChange(4_000)).toBe(9_000);
  });

  it("the max wait bounds a long burst", () => {
    const c = new ChangeCoalescer(5_000, 30_000);
    c.noteChange(1_000);
    expect(c.noteChange(29_000)).toBe(31_000); // 1_000 + 30_000, not 34_000
  });

  it("reset starts a fresh window", () => {
    const c = new ChangeCoalescer(5_000, 30_000);
    c.noteChange(1_000);
    c.reset();
    expect(c.noteChange(50_000)).toBe(55_000);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm --filter @musex/desktop exec vitest run src/logic/library-watch.test.ts`
Expected: FAIL — cannot resolve `./library-watch`.

- [ ] **Step 3: Implement the module**

Create `packages/desktop/src/logic/library-watch.ts`:

```ts
/** Pure decision logic for the Plex library watcher: which websocket
 *  notifications mean "our section changed", how bursts of events coalesce
 *  into one refresh, and the reconnect backoff curve. The adapter
 *  (main/adapters/library-watcher.ts) owns sockets and timers. */

const LIBRARY_IDENTIFIER = "com.plexapp.plugins.library";
/** Timeline states that mean content actually changed: 5 = item fully
 *  processed, 9 = item deleted. 0-4 are scan progress noise. */
const CHANGED_STATES = new Set([5, 9]);

/** True when a raw parsed websocket message (shape
 *  `{NotificationContainer: {type: "timeline", TimelineEntry: [...]}}`)
 *  contains a processed/deleted library item in the given section.
 *  Defensive against malformed payloads — returns false, never throws. */
export function relevantSectionChange(msg: unknown, sectionId: string): boolean {
  if (typeof msg !== "object" || msg === null) return false;
  const container = (msg as Record<string, unknown>).NotificationContainer;
  if (typeof container !== "object" || container === null) return false;
  const c = container as Record<string, unknown>;
  if (c.type !== "timeline" || !Array.isArray(c.TimelineEntry)) return false;
  return c.TimelineEntry.some((entry) => {
    if (typeof entry !== "object" || entry === null) return false;
    const e = entry as Record<string, unknown>;
    return (
      e.identifier === LIBRARY_IDENTIFIER &&
      String(e.sectionID) === sectionId &&
      typeof e.state === "number" &&
      CHANGED_STATES.has(e.state)
    );
  });
}

/** Inequality, not greater-than: a restored/reset Plex DB can move a section
 *  timestamp backwards and that must still register as a change. */
export function timestampChanged(prev: number | undefined, fresh: number | undefined): boolean {
  if (fresh == null) return false;
  return fresh !== prev;
}

const RECONNECT_BASE_MS = 1_000;
const RECONNECT_CAP_MS = 60_000;

/** Capped exponential backoff for websocket reconnects: 1s, 2s, 4s, … 60s. */
export function nextReconnectDelayMs(attempt: number): number {
  return Math.min(RECONNECT_BASE_MS * 2 ** Math.min(attempt, 30), RECONNECT_CAP_MS);
}

/** Coalesces a burst of change events into one refresh moment: each event
 *  re-arms a quiet-period timer, bounded by a max wait from the first event
 *  so a long scan still produces interim refreshes. Pure time arithmetic —
 *  the caller passes `now` in and owns the actual timer. */
export class ChangeCoalescer {
  private firstAt: number | null = null;

  constructor(
    private readonly quietMs: number,
    private readonly maxWaitMs: number,
  ) {}

  /** Record a change at `now`; returns the timestamp the refresh is due. */
  noteChange(now: number): number {
    if (this.firstAt === null) this.firstAt = now;
    return Math.min(now + this.quietMs, this.firstAt + this.maxWaitMs);
  }

  /** Call after firing the refresh so the next change opens a fresh window. */
  reset(): void {
    this.firstAt = null;
  }
}
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `pnpm --filter @musex/desktop exec vitest run src/logic/library-watch.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
pnpm check && git add -A && git commit -m "feat: pure library-watch logic (notification parse, coalescer, backoff)" && git push
```

---

### Task 2: Map scannedAt into Library.updatedAt

**Files:**
- Modify: `packages/desktop/src/main/adapters/plex-gateway.ts` (listMusicLibraries, ~line 146)

No new unit test (the mapping runs against a live Plex server; covered by the env-gated `MUSEX_PLEX_E2E` smoke test and typecheck).

- [ ] **Step 1: Change the mapping**

In `listMusicLibraries`, the section map currently ends with:

```ts
          updatedAt: s.updatedAt.getTime(),
```

Replace with:

```ts
          // scannedAt moves on every completed scan; updatedAt only on
          // section-settings changes. The max is what "content changed"
          // actually keys on — the whole validator system derives from it.
          updatedAt: Math.max(s.updatedAt.getTime(), s.scannedAt.getTime()),
```

(`s.scannedAt: Date` exists on `@ctrl/plex`'s section type — verified in the installed `library.d.ts:619`.)

- [ ] **Step 2: Verify and commit**

Run: `pnpm check`
Expected: exit 0.

```bash
git add -A && git commit -m "fix: include scannedAt in library section updatedAt (scans now move validators)" && git push
```

---

### Task 3: LibraryWatcher adapter

**Files:**
- Create: `packages/desktop/src/main/adapters/library-watcher.ts`

No unit test for the adapter itself (it is socket/timer plumbing over the tested pure logic, like MpvController; behavior is verified end-to-end in Task 5). `pnpm check` is the gate.

- [ ] **Step 1: Implement the adapter**

Create `packages/desktop/src/main/adapters/library-watcher.ts`:

```ts
import type { Library } from "@musex/core";
import { PlexAuthError } from "@musex/core";
import {
  ChangeCoalescer,
  nextReconnectDelayMs,
  relevantSectionChange,
  timestampChanged,
} from "../../logic/library-watch.js";

export interface LibraryWatcherDeps {
  getToken(): string | null;
  /** Resolves the server's base URL + per-server token (proxy-independent). */
  endpoint(serverId: string, token: string): Promise<{ baseUrl: string; token: string }>;
  /** Lists the server's music sections (only uses server id/name). */
  listMusicLibraries(serverId: string, serverName: string, token: string): Promise<Library[]>;
  /** The refresh pipeline: evict caches, persist, push to renderer. */
  onChange(fresh: Library): Promise<void>;
}

const QUIET_MS = 5_000;
const MAX_WAIT_MS = 30_000;
const POLL_INTERVAL_MS = 15 * 60_000;

/** Watches the selected library's Plex server for content changes: a
 *  websocket to PMS `/:/websockets/notifications` (push, primary) plus a
 *  15-minute section-timestamp poll (fallback, also run on every reconnect to
 *  cover events missed while disconnected). All decision logic is in pure
 *  logic/library-watch.ts; this class owns the socket and timers.
 *
 *  Electron 42 main = Node 24, so the global WebSocket is available. We
 *  deliberately do NOT use @ctrl/plex's AlertListener: it has no reconnect
 *  and attaches no error handler to its `ws` socket (an unhandled error
 *  event would crash main). */
export class LibraryWatcher {
  private library: Library | null = null;
  private ws: WebSocket | null = null;
  private disposed = false;
  /** Increments on every (re)start so stale socket callbacks become no-ops. */
  private generation = 0;
  private reconnectAttempt = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private refreshTimer: NodeJS.Timeout | null = null;
  private readonly coalescer = new ChangeCoalescer(QUIET_MS, MAX_WAIT_MS);
  private refreshing = false;

  constructor(private readonly deps: LibraryWatcherDeps) {}

  /** Start/retarget/stop watching. Idempotent; safe to call with the same
   *  library (no reconnect churn) or null (stop). */
  setLibrary(library: Library | null): void {
    if (this.disposed) return;
    if (library && this.library && library.id === this.library.id) {
      this.library = library; // keep the freshest updatedAt for poll compares
      return;
    }
    this.stopTimersAndSocket();
    this.library = library;
    if (!library || !this.deps.getToken()) return;
    this.generation += 1;
    this.reconnectAttempt = 0;
    void this.connect(this.generation);
    this.pollTimer = setInterval(() => void this.pollOnce(), POLL_INTERVAL_MS);
  }

  private async connect(gen: number): Promise<void> {
    const lib = this.library;
    const token = this.deps.getToken();
    if (this.disposed || gen !== this.generation || !lib || !token) return;
    try {
      const ep = await this.deps.endpoint(lib.serverId, token);
      if (this.disposed || gen !== this.generation) return;
      const wsUrl = `${ep.baseUrl.replace(/^http/, "ws")}/:/websockets/notifications?X-Plex-Token=${encodeURIComponent(ep.token)}`;
      const ws = new WebSocket(wsUrl);
      this.ws = ws;
      ws.onopen = () => {
        if (gen !== this.generation) return;
        this.reconnectAttempt = 0;
        console.log("[musex library] watcher connected");
        // Catch up on anything that changed while we weren't listening.
        void this.pollOnce();
      };
      ws.onmessage = (ev) => {
        if (gen !== this.generation) return;
        let msg: unknown;
        try {
          msg = JSON.parse(String(ev.data));
        } catch {
          return; // not JSON — not a notification we care about
        }
        if (this.library && relevantSectionChange(msg, this.library.id)) {
          this.scheduleRefresh();
        }
      };
      ws.onerror = () => {
        // onclose always follows; reconnect logic lives there.
      };
      ws.onclose = () => {
        if (this.disposed || gen !== this.generation) return;
        this.ws = null;
        this.scheduleReconnect(gen);
      };
    } catch (err) {
      // endpoint() failed (server unreachable) — back off and retry.
      console.error("[musex library] watcher connect failed:", err);
      this.scheduleReconnect(gen);
    }
  }

  private scheduleReconnect(gen: number): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    const delay = nextReconnectDelayMs(this.reconnectAttempt);
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect(gen);
    }, delay);
  }

  /** Websocket said our section changed: refresh after the coalescing window. */
  private scheduleRefresh(): void {
    const dueAt = this.coalescer.noteChange(Date.now());
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(
      () => {
        this.refreshTimer = null;
        this.coalescer.reset();
        void this.refresh({ force: true });
      },
      Math.max(0, dueAt - Date.now()),
    );
  }

  /** Poll fallback: refresh only when the section timestamp moved. */
  private async pollOnce(): Promise<void> {
    await this.refresh({ force: false });
  }

  /** force=true (websocket-triggered): fire onChange even if the timestamp
   *  didn't move — the push told us content changed and correctness must not
   *  depend on Plex bumping section timestamps. force=false (poll): only on
   *  a timestamp change. */
  private async refresh(opts: { force: boolean }): Promise<void> {
    const lib = this.library;
    const token = this.deps.getToken();
    if (this.disposed || !lib || !token || this.refreshing) return;
    this.refreshing = true;
    try {
      const sections = await this.deps.listMusicLibraries(lib.serverId, lib.serverName, token);
      const fresh = sections.find((s) => s.id === lib.id);
      if (!fresh) {
        console.error(`[musex library] watched section ${lib.id} no longer exists on the server`);
        return;
      }
      if (!opts.force && !timestampChanged(lib.updatedAt, fresh.updatedAt)) return;
      await this.deps.onChange(fresh);
      this.library = fresh;
      console.log(`[musex library] section "${fresh.title}" changed — refreshed`);
    } catch (err) {
      if (err instanceof PlexAuthError) {
        console.error("[musex library] watcher stopping: Plex auth failed");
        this.setLibrary(null); // the sign-in flow owns recovery
        return;
      }
      // Transient (server down, network) — keep state; the next websocket
      // event, poll tick, or reconnect retries naturally.
      console.error("[musex library] refresh failed:", err);
    } finally {
      this.refreshing = false;
    }
  }

  private stopTimersAndSocket(): void {
    this.generation += 1; // invalidate in-flight callbacks
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
    this.coalescer.reset();
    this.ws?.close();
    this.ws = null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopTimersAndSocket();
  }
}
```

- [ ] **Step 2: Verify and commit**

Run: `pnpm check`
Expected: exit 0.

```bash
git add -A && git commit -m "feat: LibraryWatcher (PMS websocket + poll fallback, coalesced refresh)" && git push
```

---

### Task 4: Wiring — Runtime pipeline, IPC push, renderer state

**Files:**
- Modify: `packages/desktop/src/main/runtime.ts`
- Modify: `packages/desktop/src/shared/ipc-contract.ts`
- Modify: `packages/desktop/src/preload/index.ts`
- Modify: `packages/desktop/src/main/ipc.ts`
- Modify: `packages/desktop/src/main/index.ts`
- Modify: `packages/desktop/src/renderer/src/state/app.tsx`

Plumbing over tested pieces — `pnpm check` (typecheck) is the gate; behavior verified end-to-end in Task 5.

- [ ] **Step 1: IPC contract**

In `packages/desktop/src/shared/ipc-contract.ts`:

(a) In the `IPC` const, next to the `navigateTo` push channel (~line 97):

```ts
  libraryChanged: "musex:library:changed", // push: main -> renderer Library (watcher refreshed the section)
```

(b) In the `MusexApi` interface, next to `onNavigateTo` (~line 438):

```ts
  /** Fired when the library watcher refreshed the section (new updatedAt). */
  onLibraryChanged(cb: (lib: Library) => void): () => void;
```

(`Library` is already imported in this file — `RestoreSessionResult` uses it.)

- [ ] **Step 2: Preload**

In `packages/desktop/src/preload/index.ts`, next to `onNavigateTo` (mirror its shape exactly; add `Library` to the type imports from `@musex/core` if not present — check first, the file may already import it):

```ts
  onLibraryChanged: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, lib: Library) => cb(lib);
    ipcRenderer.on(IPC.libraryChanged, listener);
    return () => ipcRenderer.removeListener(IPC.libraryChanged, listener);
  },
```

- [ ] **Step 3: Runtime — watcher construction + refresh pipeline**

In `packages/desktop/src/main/runtime.ts`:

(a) Imports: add `LibraryWatcher` (value) from `./adapters/library-watcher.js` and add `Library` to the existing `@musex/core` type import if missing.

(b) Fields, near the other coordinator fields:

```ts
  libraryWatcher!: LibraryWatcher;
  /** Set by main/index per window (same pattern as pluginNotifySink). */
  private libraryChangedSink: ((lib: Library) => void) | null = null;
```

and next to `setPluginNotifySink`:

```ts
  setLibraryChangedSink(sink: ((lib: Library) => void) | null): void {
    this.libraryChangedSink = sink;
  }
```

(c) In `init()`, after the `ExpansionCoordinator` construction:

```ts
    this.libraryWatcher = new LibraryWatcher({
      getToken: () => this.token,
      endpoint: (serverId, token) => this.gateway.endpoint(serverId, token),
      listMusicLibraries: (serverId, serverName, token) =>
        this.gateway.listMusicLibraries({ id: serverId, name: serverName, connections: [] }, token),
      onChange: async (fresh) => {
        // Whole-store evict is deliberate: Plex doesn't reliably bump nested
        // updatedAt (e.g. an artist's when an album lands), so nested
        // validators can't be trusted after a change. The cache refills lazily.
        await this.listCache.clear();
        persistence.setLibrary(fresh);
        this.libraries = this.libraries.map((l) => (l.id === fresh.id ? fresh : l));
        this.libraryChangedSink?.(fresh);
      },
    });
```

(d) At the end of `restore()` (token just loaded — the watcher can connect):

```ts
    this.libraryWatcher.setLibrary(persistence.getLibrary());
```

- [ ] **Step 4: selectLibrary handler retargets the watcher**

In `packages/desktop/src/main/ipc.ts`, the `IPC.selectLibrary` handler currently reads:

```ts
  ipcMain.handle(IPC.selectLibrary, (_e, libraryId: string) => {
    const lib = rt.findLibrary(libraryId);
    persistence.setLibrary(lib);
  });
```

Add one line:

```ts
  ipcMain.handle(IPC.selectLibrary, (_e, libraryId: string) => {
    const lib = rt.findLibrary(libraryId);
    persistence.setLibrary(lib);
    rt.libraryWatcher.setLibrary(lib);
  });
```

- [ ] **Step 5: main/index.ts — renderer push + dispose**

In `packages/desktop/src/main/index.ts`:

(a) Inside `wireEngineEvents`, next to `runtime.setPluginNotifySink(...)`:

```ts
    runtime.setLibraryChangedSink((lib) => {
      if (!win.isDestroyed()) win.webContents.send(IPC.libraryChanged, lib);
    });
```

(b) In the `will-quit` handler, alongside `runtime.expansion.dispose()`:

```ts
    runtime.libraryWatcher.dispose();
```

- [ ] **Step 6: Renderer state**

In `packages/desktop/src/renderer/src/state/app.tsx`:

(a) Add to the `Action` union:

```ts
  | { type: "library-updated"; library: Library }
```

(b) Add to the reducer switch:

```ts
    case "library-updated":
      // Only refresh in place — never resurrect a stale push after sign-out
      // or a library switch. View/search state stays untouched.
      if (s.auth !== "signed-in" || !s.library || s.library.id !== a.library.id) return s;
      return { ...s, library: a.library };
```

(c) In `AppProvider`, add a second `useEffect` after the restoreSession one:

```ts
  useEffect(() => {
    return window.musex.onLibraryChanged((library) => {
      dispatch({ type: "library-updated", library });
    });
  }, []);
```

- [ ] **Step 7: Verify and commit**

Run: `pnpm check`
Expected: exit 0 (typecheck proves contract/preload/runtime/renderer agree).

```bash
git add -A && git commit -m "feat: wire library watcher — refresh pipeline, IPC push, renderer state" && git push
```

---

### Task 5: End-to-end verification (controller runs this, not a subagent)

- [ ] **Step 1: Live verification against the real Plex server**

Launch `pnpm dev` (with a CDP port for inspection). Confirm in the unified log/console that the watcher connects (`[musex library] watcher connected`). Then trigger a Plex section change (add a file to the library or trigger a partial scan via the Plex UI/API) and observe: the `[musex library] section … changed — refreshed` log line, the renderer's artists/albums views picking up the new item without a restart, and `config.json`'s persisted library carrying the new `updatedAt`. If no Plex write access is available, at minimum verify: watcher connects, a forced `refresh` (e.g. via a Plex scan of an unchanged section) does NOT spuriously evict (poll path with unchanged timestamp), and app behavior is unchanged elsewhere.

- [ ] **Step 2: Full bar**

Run: `pnpm check`
Expected: exit 0.

---

### Task 6: Docs + PR

- [ ] **Step 1: CLAUDE.md**

Append a bullet to the Architecture section of `/Users/matjam/src/musex/CLAUDE.md` (after the audio-filters bullet) recording: library staleness fix (spec link); `Library.updatedAt` now maps `max(updatedAt, scannedAt)`; pure `logic/library-watch.ts` + `LibraryWatcher` adapter (PMS notifications websocket via Node 24 global WebSocket — NOT @ctrl/plex's AlertListener, which has no reconnect/error handler and would crash main; 15-min poll fallback + poll-on-reconnect; 5s/30s coalescing); change pipeline = listCache.clear() → persist fresh Library → `musex:library:changed` push → renderer swaps `library` state and every view's existing `library`-keyed useEffect refetches.

- [ ] **Step 2: Commit, push, PR**

```bash
git add -A && git commit -m "docs: record library-watcher architecture" && git push
gh pr create --draft --title "fix: pick up new Plex library items without a restart" --body "$(cat <<'EOF'
## Summary
- Root cause: every list fetch is validated by Plex `updatedAt` timestamps the app never refreshed — the persisted library object kept its first-launch timestamp forever, so the list cache hit indefinitely and new artists/albums/tracks never appeared
- New `LibraryWatcher` in main: PMS notifications websocket (push, with reconnect/backoff) + 15-minute section-timestamp poll fallback (also runs on every reconnect)
- On change (coalesced 5s/30s): evict the list cache, persist the fresh section timestamps, push `musex:library:changed` — the renderer swaps its `library` object and every view refetches through the existing validator machinery
- `Library.updatedAt` now maps `max(updatedAt, scannedAt)` so completed scans move validators at all
- Pure decision logic (`logic/library-watch.ts`) fully unit-tested; no new dependencies (Node 24 global WebSocket)

Spec: docs/superpowers/specs/2026-06-11-library-staleness-design.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

(PR title stays conventional-commit shaped — squash subject feeds release-please; `fix:` bumps patch.)
