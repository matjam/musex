import { PlexAuthError } from "@musex/core";

export type Connectivity = "online" | "offline";
const FAILURE_THRESHOLD = 2;

export interface ConnectivityDeps {
  subscribe: (cb: (s: { isConnected: boolean | null }) => void) => () => void;
  probe: () => Promise<void>;
  onChange: (s: Connectivity) => void;
}

export class ConnectivityMonitor {
  private failures = 0;
  private state: Connectivity = "online";
  private unsub: (() => void) | null = null;

  constructor(private readonly deps: ConnectivityDeps) {}

  start(): void {
    this.unsub = this.deps.subscribe((s) => {
      if (s.isConnected === false) this.set("offline");
      else void this.checkNow();
    });
  }

  stop(): void {
    this.unsub?.();
    this.unsub = null;
  }

  async checkNow(): Promise<void> {
    try {
      await this.deps.probe();
      this.failures = 0;
      this.set("online");
    } catch (e) {
      if (e instanceof PlexAuthError) return; // sign-in owns auth; not an offline signal
      this.failures += 1;
      if (this.failures >= FAILURE_THRESHOLD) this.set("offline");
    }
  }

  private set(s: Connectivity): void {
    if (s !== this.state) {
      this.state = s;
      this.deps.onChange(s);
    }
  }
}
