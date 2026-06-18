/**
 * WebViewTransport — the RN side of the plugin sandbox postMessage RPC.
 *
 * It pairs with the WebView `harness.ts`. RN -> WebView messages (`load`,
 * `invoke`, `emit`, `dispose`) and WebView -> RN messages (`loaded`,
 * `invokeResult`, `hostCall`, `log`) flow over a single string channel.
 *
 * - `load`/`invoke` are request/reply, correlated by an incrementing id with a
 *   timeout (rejects if the WebView never answers).
 * - Inbound `hostCall` (a ctx host capability the guest called) is dispatched
 *   to the host-call handler, and its resolved value is posted back as a
 *   correlated `hostReply`.
 * - `reset()` rejects every in-flight request (used on WebView remount/crash so
 *   no promise hangs forever).
 */

import type { PluginManifest } from "@musex/plugin-api";
import type { BridgeRegState } from "@musex/plugin-host";

/** A one-way string channel to the WebView (e.g. webviewRef.postMessage). */
export interface TransportChannel {
  post(msg: string): void;
}

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

type HostCallHandler = (pluginId: string, name: string, args: unknown[]) => Promise<unknown>;

const DEFAULT_TIMEOUT_MS = 15_000;

export class WebViewTransport {
  private seq = 0;
  private readonly pending = new Map<number, Pending>();
  private readonly timeoutMs: number;
  private hostCallHandler: HostCallHandler | null = null;
  private readyHandler: (() => void) | null = null;

  constructor(
    private readonly channel: TransportChannel,
    opts?: { timeoutMs?: number },
  ) {
    this.timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /** Set the handler invoked for inbound `hostCall` messages. */
  setHostCallHandler(fn: HostCallHandler): void {
    this.hostCallHandler = fn;
  }

  /** Set the handler invoked once when the WebView harness posts `ready`. */
  setReadyHandler(fn: () => void): void {
    this.readyHandler = fn;
  }

  /** Feed a raw message string received from the WebView (`onMessage`). */
  onMessage(raw: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }
    switch (msg.type) {
      case "loaded":
        this.settle(msg.id as number, msg.regState, msg.error as string | undefined);
        break;
      case "invokeResult":
        this.settle(msg.id as number, msg.result, msg.error as string | undefined);
        break;
      case "hostCall":
        this.handleHostCall(
          msg.id as number,
          msg.pluginId as string,
          msg.name as string,
          (msg.args as unknown[]) ?? [],
        );
        break;
      case "log":
        // Surface plugin logs to the RN console for debugging.
        console.log(`[plugin:${msg.pluginId as string}]`, msg.message);
        break;
      case "ready":
        this.readyHandler?.();
        break;
    }
  }

  /** Load + activate a plugin in the WebView; resolves with its regState. */
  load(pluginId: string, manifest: PluginManifest, code: string): Promise<BridgeRegState> {
    return this.request({ type: "load", pluginId, manifest, code }) as Promise<BridgeRegState>;
  }

  /** Invoke a registered guest provider method; resolves with its JSON result. */
  invoke(pluginId: string, path: string, method: string, args: unknown[]): Promise<unknown> {
    return this.request({ type: "invoke", pluginId, path, method, args });
  }

  /** Dispatch a host event to the guest (fire-and-forget). */
  emit(pluginId: string, event: string, payload: unknown): void {
    this.channel.post(JSON.stringify({ type: "emit", pluginId, event, payload }));
  }

  /** Dispose a plugin's WebView context (fire-and-forget). */
  dispose(pluginId: string): void {
    this.channel.post(JSON.stringify({ type: "dispose", pluginId }));
  }

  /** Reject all in-flight requests (WebView remount/crash). */
  reset(): void {
    const pending = [...this.pending.values()];
    this.pending.clear();
    for (const p of pending) {
      if (p.timer) clearTimeout(p.timer);
      p.reject(new Error("plugin transport reset (WebView remounted)"));
    }
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private request(payload: Record<string, unknown>): Promise<unknown> {
    const id = ++this.seq;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`plugin transport request timed out (${payload.type as string})`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.channel.post(JSON.stringify({ id, ...payload }));
    });
  }

  private settle(id: number, value: unknown, error: string | undefined): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    if (pending.timer) clearTimeout(pending.timer);
    if (error !== undefined) pending.reject(new Error(error));
    else pending.resolve(value);
  }

  private handleHostCall(id: number, pluginId: string, name: string, args: unknown[]): void {
    const handler = this.hostCallHandler;
    if (!handler) {
      this.channel.post(
        JSON.stringify({ type: "hostReply", id, error: `no host-call handler for ${name}` }),
      );
      return;
    }
    Promise.resolve()
      .then(() => handler(pluginId, name, args))
      .then(
        (value) => this.channel.post(JSON.stringify({ type: "hostReply", id, value })),
        (err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          this.channel.post(JSON.stringify({ type: "hostReply", id, error: message }));
        },
      );
  }
}
