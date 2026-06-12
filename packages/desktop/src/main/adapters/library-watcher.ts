import type { Library } from "@musex/core";
import {
  ChangeCoalescer,
  nextReconnectDelayMs,
  PlexAuthError,
  relevantSectionChange,
  timestampChanged,
} from "@musex/core";

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
  /** A trigger landed while a refresh was in flight — run again right after. */
  private pendingRefresh = false;

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
    if (this.disposed || !lib || !token) return;
    if (this.refreshing) {
      this.pendingRefresh = true;
      return;
    }
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
      if (this.pendingRefresh && !this.disposed) {
        this.pendingRefresh = false;
        // A trigger arrived mid-refresh; its content may postdate our fetch.
        void this.refresh({ force: true });
      }
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
    this.pendingRefresh = false;
    this.ws?.close();
    this.ws = null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopTimersAndSocket();
  }
}
