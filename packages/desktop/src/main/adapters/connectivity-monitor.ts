import { PlexAuthError } from "@musex/core";

// Use `unknown` for the handle so both Node (NodeJS.Timeout) and test fakes
// (plain number) satisfy the interface without a cast.
export interface TimerFunctions {
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

/** Debounced reachability state machine.
 *
 * A probe failure only flips `online` to false once FAILURE_THRESHOLD consecutive
 * failures have been recorded.  A single success resets the counter and, if
 * currently offline, flips back to online.
 *
 * PlexAuthError (or any Error whose `.name === "PlexAuthError"`) is explicitly
 * excluded from the failure counter: the sign-in flow owns authentication
 * recovery and a 401 does not mean the server is unreachable. */
export class ConnectivityMonitor {
  private static readonly FAILURE_THRESHOLD = 2;

  private _online = true;
  private consecutiveFailures = 0;
  private readonly listeners: Array<(online: boolean) => void> = [];
  private handle: unknown;
  private readonly timers: TimerFunctions;

  constructor(timers?: TimerFunctions) {
    this.timers = timers ?? {
      setInterval: globalThis.setInterval.bind(globalThis),
      clearInterval: globalThis.clearInterval.bind(globalThis),
    };
  }

  get online(): boolean {
    return this._online;
  }

  onChange(cb: (online: boolean) => void): void {
    this.listeners.push(cb);
  }

  noteSuccess(): void {
    this.consecutiveFailures = 0;
    if (!this._online) {
      this._online = true;
      this.emit(true);
    }
  }

  noteFailure(err: unknown): void {
    if (isAuthError(err)) return;
    this.consecutiveFailures++;
    if (this._online && this.consecutiveFailures >= ConnectivityMonitor.FAILURE_THRESHOLD) {
      this._online = false;
      this.emit(false);
    }
  }

  start(probe: () => Promise<void>, intervalMs: number): void {
    this.stop();
    this.handle = this.timers.setInterval(() => {
      void probe().then(
        () => this.noteSuccess(),
        (err: unknown) => this.noteFailure(err),
      );
    }, intervalMs);
  }

  stop(): void {
    if (this.handle !== undefined) {
      this.timers.clearInterval(this.handle);
      this.handle = undefined;
    }
  }

  private emit(online: boolean): void {
    for (const cb of this.listeners) cb(online);
  }
}

function isAuthError(err: unknown): boolean {
  if (err instanceof PlexAuthError) return true;
  if (err instanceof Error && err.name === "PlexAuthError") return true;
  return false;
}
