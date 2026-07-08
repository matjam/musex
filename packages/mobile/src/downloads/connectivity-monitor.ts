import { type ConnectionType, PlexAuthError } from "@musex/core";

export type Connectivity = "online" | "offline";
const FAILURE_THRESHOLD = 2;

export interface ConnectivityDeps {
  subscribe: (cb: (s: { isConnected: boolean | null; type?: string }) => void) => () => void;
  probe: () => Promise<void>;
  onChange: (s: Connectivity) => void;
}

/** NetInfo `state.type` → the core routing ConnectionType. */
function mapConnectionType(type: string | undefined): ConnectionType {
  if (type === "wifi") return "wifi";
  if (type === "cellular") return "cellular";
  if (type == null || type === "none") return "none";
  return "other";
}

export class ConnectivityMonitor {
  private failures = 0;
  private state: Connectivity = "online";
  private unsub: (() => void) | null = null;
  /** "other" until the first netinfo event — a cold enqueue must not
   *  false-cellular (non-cellular routes to the convert path). */
  private connType: ConnectionType = "other";

  constructor(private readonly deps: ConnectivityDeps) {}

  start(): void {
    this.unsub = this.deps.subscribe((s) => {
      this.connType = mapConnectionType(s.type);
      if (s.isConnected === false) this.set("offline");
      else void this.checkNow();
    });
  }

  stop(): void {
    this.unsub?.();
    this.unsub = null;
  }

  /** Last netinfo connection class — feeds the download routing decision. */
  connectionType(): ConnectionType {
    return this.connType;
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
