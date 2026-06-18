/**
 * PluginManager — RN orchestration of installed sandboxed plugins.
 *
 * For each enabled installed plugin it reads the entry module from the file
 * store, loads + activates it in the WebView sandbox (`SandboxController.load`,
 * which returns the guest's `BridgeRegState`), and wires the guest's
 * registrations into the `ProviderHub` via the shared, transport-agnostic
 * `registerHubProxies` from `@musex/plugin-host`. The proxy `callGuest` channel
 * is `(path, method, ...args) => sandbox.invoke(id, path, method, args)` — so a
 * hub fan-out call (e.g. `hub.lookupArtistAlbums`) round-trips into the guest.
 *
 * A plugin whose `sandbox.load` throws is recorded with status "error" and
 * logged; it never blocks the others, and `loadAll` never rejects.
 *
 * Event delivery to guests flows through the hub: `registerHubProxies` subscribes
 * the guest's `eventHandlers` via `hub.onEvent` (each calling `callGuest("__emit",
 * …)` → the guest's __emit dispatcher), so `emitEvent` only has to
 * `hub.dispatchEvent`. This mirrors desktop's PluginHost.emitEvent exactly — a
 * separate `sandbox.emit` would double-deliver.
 */

import type { PluginEvents } from "@musex/plugin-api";
import { type BridgeRegState, type ProviderHub, registerHubProxies } from "@musex/plugin-host";
import type { PluginIndex } from "./plugin-index.js";
import type { PluginFileStore } from "./plugin-store.js";
import type { SandboxController } from "./sandbox-host.js";

export interface PluginManagerDeps {
  index: PluginIndex;
  store: PluginFileStore;
  sandbox: SandboxController;
  hub: ProviderHub;
  /** Optional sink for per-plugin disposables (e.g. settings actions). */
  trackDisposable?: (id: string, d: { dispose(): void }) => void;
}

type PluginStatus = "active" | "error" | "disabled";

interface LoadedState {
  status: PluginStatus;
  error?: string;
  regState: BridgeRegState | null;
  /** Hub registration disposables created for this plugin (torn down on
   *  disable/reload). */
  disposables: { dispose(): void }[];
}

export interface PluginListItem {
  id: string;
  name: string;
  version: string;
  enabled: boolean;
  status: PluginStatus;
  error?: string;
  registered: BridgeRegState | null;
}

export class PluginManager {
  private readonly loaded = new Map<string, LoadedState>();

  constructor(private readonly deps: PluginManagerDeps) {}

  /** Activate every enabled installed plugin. Never rejects: a single plugin
   *  failing to load is recorded as status "error" and the rest still load. */
  async loadAll(): Promise<void> {
    for (const p of this.deps.index.all()) {
      if (!p.enabled) {
        this.loaded.set(p.id, { status: "disabled", regState: null, disposables: [] });
        continue;
      }
      await this.activate(p.id);
    }
  }

  /** Tear down all active plugins (hub registrations + sandbox contexts) and
   *  re-load from the current index. */
  async reloadAll(): Promise<void> {
    for (const id of [...this.loaded.keys()]) this.deactivate(id);
    this.loaded.clear();
    await this.loadAll();
  }

  /** Persist the enable flag and activate/deactivate to match. */
  async setEnabled(id: string, v: boolean): Promise<void> {
    await this.deps.index.setEnabled(id, v);
    if (v) {
      await this.activate(id);
    } else {
      this.deactivate(id);
      this.loaded.set(id, { status: "disabled", regState: null, disposables: [] });
    }
  }

  list(): PluginListItem[] {
    return this.deps.index.all().map((p) => {
      const st = this.loaded.get(p.id);
      return {
        id: p.id,
        name: p.manifest.name,
        version: p.manifest.version,
        enabled: p.enabled,
        status: st?.status ?? (p.enabled ? "error" : "disabled"),
        ...(st?.error !== undefined ? { error: st.error } : {}),
        registered: st?.regState ?? null,
      };
    });
  }

  /** Dispatch a host event. Guest handlers receive it through the hub
   *  subscriptions wired by registerHubProxies (see the class doc). */
  emitEvent<K extends keyof PluginEvents>(event: K, payload: PluginEvents[K]): void {
    this.deps.hub.dispatchEvent(event, payload);
  }

  // ── internals ──────────────────────────────────────────────────────────────

  /** Load + register one plugin. Records status "error" on any failure and
   *  never throws (the caller iterates many plugins). */
  private async activate(id: string): Promise<void> {
    // Replace any prior activation cleanly.
    this.deactivate(id);
    const installed = this.deps.index.get(id);
    if (!installed) return;

    const disposables: { dispose(): void }[] = [];
    try {
      const code = await this.deps.store.readEntry(id, installed.manifest.entry);
      const regState = await this.deps.sandbox.load(id, installed.manifest, code);
      registerHubProxies(
        this.deps.hub,
        id,
        regState,
        (path, method, ...args) => this.deps.sandbox.invoke(id, path, method, args),
        (d) => {
          disposables.push(d);
          this.deps.trackDisposable?.(id, d);
        },
      );
      this.loaded.set(id, { status: "active", regState, disposables });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[plugins] ${id} failed to activate:`, err);
      // Undo any partial hub registrations from this attempt.
      for (const d of disposables) {
        try {
          d.dispose();
        } catch {
          /* tearing down */
        }
      }
      this.loaded.set(id, { status: "error", error: message, regState: null, disposables: [] });
    }
  }

  /** Dispose a plugin's hub registrations and its sandbox context. */
  private deactivate(id: string): void {
    const st = this.loaded.get(id);
    if (st) {
      for (const d of st.disposables) {
        try {
          d.dispose();
        } catch {
          /* tearing down */
        }
      }
      st.disposables = [];
    }
    // Always ask the sandbox to drop the context — harmless if not loaded.
    this.deps.sandbox.dispose(id);
  }
}
