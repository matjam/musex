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
