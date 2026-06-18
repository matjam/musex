import { access, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  Disposable,
  LibrarySearchResult,
  PluginContext,
  PluginEvents,
  PluginManifest,
  SettingField,
  SettingsActionResult,
  TrackInfo,
} from "@musex/plugin-api";
import type { ProviderHub } from "@musex/plugin-host";
import { loadSandboxedPlugin } from "@musex/plugin-host/sandbox";
import { validateManifest } from "../../logic/plugin-manifest.js";
import type { PluginInfo, PluginNotification, PluginSettings } from "../../shared/ipc-contract.js";
import type { CorePlugin } from "./core-plugins.js";
import { createNetClient } from "./net-client.js";
import { buildPluginContext } from "./plugin-context.js";
import {
  createPluginSecrets,
  createPluginStorage,
  type PluginSecrets,
  type PluginStorage,
} from "./plugin-store.js";

export const HOST_API_VERSION = 2;

export interface PluginHostDeps {
  /** Runtime-owned hub that owns the registry + fan-out methods.
   *  PluginHost registers plugin contributions into it via buildPluginContext. */
  hub: ProviderHub;
  /** First-party plugins that are statically imported and bundled with the app.
   *  Activated before any dynamic scan; their ids win on collision with user plugins.
   *  Defaults to [] when omitted (useful in tests that exercise only user plugin loading). */
  corePlugins?: readonly CorePlugin[];
  /** Dirs whose subdirectories are plugins: each sub must contain `plugin.json`
   *  at its root (the entry file named in the manifest sits alongside it). */
  scanDirs: string[];
  dataDir: string;
  secretsDir: string;
  encrypt: (s: string) => Promise<string>;
  decrypt: (s: string) => Promise<string>;
  isEnabled: (id: string) => boolean;
  setEnabled: (id: string, v: boolean) => void;
  notifySink: (payload: PluginNotification) => void;
  /** Production validates http/https and calls shell.openExternal. */
  openExternal: (url: string) => void;
  /** v1 stubs in this task; Task 2 swaps real implementations in without
   *  touching plugins. */
  library: {
    search(query: string): Promise<LibrarySearchResult>;
    recentlyPlayed(limit?: number): Promise<TrackInfo[]>;
    topArtists(limit?: number): Promise<{ name: string; score: number }[]>;
  };
}

interface PluginModule {
  activate?: (ctx: PluginContext) => void | Promise<void>;
  deactivate?: () => void | Promise<void>;
}

interface LoadedPlugin {
  manifest: PluginManifest;
  /** Directory containing plugin.json + the entry file (empty for core plugins). */
  dir: string;
  /** "core" = statically bundled first-party; "user" = dynamically loaded from userData. */
  origin: "core" | "user";
  status: PluginInfo["status"];
  error?: string;
  module?: PluginModule;
  disposables: Disposable[];
  settingsSchema: SettingField[];
  settingsActions: Map<string, () => Promise<SettingsActionResult>>;
  storage: PluginStorage;
  secrets: PluginSecrets;
}

/**
 * Dynamic plugin host: scans plugin directories, validates manifests,
 * `import()`s entries and activates them with a per-plugin capability context.
 * Every plugin interaction is isolated — a throwing plugin is marked errored
 * and must never take the host (or another plugin) down with it.
 *
 * All paths/services are constructor-injected so tests run without Electron.
 *
 * Fan-out methods (getSimilar, recommendTracks, getSections, etc.) and the
 * provider registry now live in the Runtime-owned ProviderHub (deps.hub).
 * Plugin-management methods (list/setEnabled/reload/install/settings) stay here.
 */
export class PluginHost {
  private readonly plugins = new Map<string, LoadedPlugin>();

  constructor(private readonly deps: PluginHostDeps) {}

  async loadAll(): Promise<void> {
    // Core plugins run first so their ids win on collision with user plugins.
    await this.loadCore(this.deps.corePlugins ?? []);
    for (const found of await this.scan()) {
      await this.loadOne(found.dir, found.json);
    }
  }

  /** Dispose all registrations, deactivate, re-scan and re-import everything.
   *  Core plugins are re-activated against the fresh registry on every reload. */
  async reloadAll(): Promise<void> {
    for (const rec of this.plugins.values()) {
      if (rec.status === "active") await this.deactivatePlugin(rec);
    }
    this.plugins.clear();
    await this.loadAll();
  }

  list(): PluginInfo[] {
    return [...this.plugins.values()].map((rec) => ({
      id: rec.manifest.id,
      name: rec.manifest.name,
      version: rec.manifest.version,
      status: rec.status,
      origin: rec.origin,
      ...(rec.error !== undefined ? { error: rec.error } : {}),
    }));
  }

  // ── core plugin loading ───────────────────────────────────────────────────

  private async loadCore(corePlugins: readonly CorePlugin[]): Promise<void> {
    for (const cp of corePlugins) {
      if (this.plugins.has(cp.manifest.id)) {
        // Should never happen on first load; guard against double-call.
        console.error(`[plugins] duplicate core plugin id "${cp.manifest.id}" — skipped`);
        continue;
      }
      if (cp.manifest.apiVersion !== HOST_API_VERSION) {
        // List as incompatible (visible in Settings) rather than silently dropping.
        const reason = `incompatible: requires API v${cp.manifest.apiVersion}, host is v${HOST_API_VERSION}`;
        console.error(`[plugins] core plugin "${cp.manifest.id}" ${reason}`);
        this.plugins.set(cp.manifest.id, {
          manifest: {
            id: cp.manifest.id,
            name: cp.manifest.name,
            version: cp.manifest.version,
            apiVersion: cp.manifest.apiVersion,
            entry: "",
          },
          dir: "",
          origin: "core",
          status: "incompatible",
          error: reason,
          disposables: [],
          settingsSchema: [],
          settingsActions: new Map(),
          storage: createPluginStorage(this.deps.dataDir, cp.manifest.id),
          secrets: createPluginSecrets(
            this.deps.secretsDir,
            cp.manifest.id,
            this.deps.encrypt,
            this.deps.decrypt,
          ),
        });
        continue;
      }
      const rec: LoadedPlugin = {
        manifest: {
          id: cp.manifest.id,
          name: cp.manifest.name,
          version: cp.manifest.version,
          apiVersion: cp.manifest.apiVersion,
          entry: "",
        },
        dir: "",
        origin: "core",
        status: "disabled",
        disposables: [],
        settingsSchema: [],
        settingsActions: new Map(),
        storage: createPluginStorage(this.deps.dataDir, cp.manifest.id),
        secrets: createPluginSecrets(
          this.deps.secretsDir,
          cp.manifest.id,
          this.deps.encrypt,
          this.deps.decrypt,
        ),
      };
      this.plugins.set(cp.manifest.id, rec);
      if (!this.deps.isEnabled(cp.manifest.id)) continue;
      await this.activateCorePlugin(rec, cp.activate, cp.deactivate);
    }
  }

  private async activateCorePlugin(
    rec: LoadedPlugin,
    activate: (ctx: PluginContext) => void | Promise<void>,
    deactivate?: () => void | Promise<void>,
  ): Promise<void> {
    try {
      rec.module = { activate, deactivate };
      const ctx = buildPluginContext(
        rec.manifest,
        {
          storage: rec.storage,
          secrets: rec.secrets,
          notifySink: this.deps.notifySink,
          openExternal: this.deps.openExternal,
          library: this.deps.library,
          registerSettings: (schema) => {
            rec.settingsSchema = schema;
          },
          onSettingsAction: (key, handler) => {
            rec.settingsActions.set(key, handler);
          },
        },
        this.deps.hub,
        (d) => rec.disposables.push(d),
      );
      await activate(ctx);
      rec.status = "active";
      rec.error = undefined;
    } catch (err) {
      rec.status = "error";
      rec.error = err instanceof Error ? err.message : String(err);
      this.disposeRegistrations(rec);
      rec.settingsSchema = [];
      rec.settingsActions.clear();
      console.error(`[plugins] core plugin ${rec.manifest.id} failed to activate:`, err);
    }
  }

  async setEnabled(id: string, v: boolean): Promise<void> {
    const rec = this.require(id);
    this.deps.setEnabled(id, v);
    if (rec.status === "incompatible") return; // listed but never activatable
    if (v) {
      if (rec.status === "active") return;
      if (rec.origin === "core") {
        // Core plugins are statically bundled — re-activate via the static path,
        // never via dynamic import() which would try to import a directory ("").
        const cp = (this.deps.corePlugins ?? []).find((c) => c.manifest.id === id);
        if (cp === undefined) {
          rec.status = "error";
          rec.error = `core plugin "${id}" not found in corePlugins`;
          return;
        }
        await this.activateCorePlugin(rec, cp.activate, cp.deactivate);
      } else {
        await this.activatePlugin(rec);
      }
    } else {
      if (rec.status === "active") await this.deactivatePlugin(rec);
      rec.status = "disabled";
      rec.error = undefined;
    }
  }

  /** Fan an event out to every subscriber of that event via the hub, isolating
   *  failures — a throwing plugin handler is logged and never blocks the rest.
   *  Delegates to the hub's dispatchEvent. */
  emitEvent<K extends keyof PluginEvents>(event: K, payload: PluginEvents[K]): void {
    this.deps.hub.dispatchEvent(event, payload);
  }

  async getSettings(id: string): Promise<PluginSettings> {
    const rec = this.require(id);
    const values: Record<string, unknown> = {};
    for (const field of rec.settingsSchema) {
      if (field.kind === "action") continue; // buttons have no value
      if (field.kind === "password") {
        // Presence only — the secret itself never crosses to the renderer.
        values[field.key] = { set: (await rec.secrets.get(field.key)) !== null };
      } else {
        values[field.key] = await rec.storage.get(field.key);
      }
    }
    return { schema: rec.settingsSchema, values };
  }

  async setSetting(id: string, key: string, value: unknown): Promise<void> {
    const rec = this.require(id);
    const field = rec.settingsSchema.find((f) => f.key === key);
    if (!field) throw new Error(`plugin ${id} has no setting "${key}"`);
    if (field.kind === "password") {
      if (value !== null && typeof value !== "string") {
        throw new Error("password value must be a string or null");
      }
      await rec.secrets.set(key, value);
    } else {
      await rec.storage.set(key, value);
    }
  }

  async runSettingsAction(id: string, key: string): Promise<SettingsActionResult> {
    const rec = this.require(id);
    const handler = rec.settingsActions.get(key);
    if (!handler) return { ok: false, message: `no action "${key}" registered` };
    try {
      return await handler();
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }

  // ── loading ──────────────────────────────────────────────────────────────

  private async scan(): Promise<{ dir: string; json: unknown }[]> {
    const found: { dir: string; json: unknown }[] = [];
    for (const scanDir of this.deps.scanDirs) {
      let subs: string[];
      try {
        subs = await readdir(scanDir);
      } catch (err) {
        // A scan dir that doesn't exist yet is normal (no plugins installed).
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
          console.error(`[plugins] cannot read scan dir ${scanDir}:`, err);
        }
        continue;
      }
      for (const sub of subs) {
        // User plugins: plugin.json at the dir root, entry file alongside it.
        const dir = join(scanDir, sub);
        const manifestPath = join(dir, "plugin.json");
        let raw: string;
        try {
          raw = await readFile(manifestPath, "utf8");
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
            console.error(`[plugins] cannot read ${manifestPath}:`, err);
          }
          continue;
        }
        let json: unknown;
        try {
          json = JSON.parse(raw);
        } catch (err) {
          console.error(`[plugins] malformed JSON in ${manifestPath}:`, err);
          continue;
        }
        // A manifest whose entry file is absent is not a usable candidate —
        // keep looking rather than failing at import time.
        const entry = (json as Record<string, unknown>).entry;
        if (typeof entry === "string" && entry.length > 0) {
          try {
            await access(join(dir, entry));
          } catch {
            console.error(
              `[plugins] ${manifestPath}: entry "${entry}" not found next to the manifest` +
                ` (unbuilt plugin?)`,
            );
            continue;
          }
        }
        found.push({ dir, json });
      }
    }
    return found;
  }

  private async loadOne(dir: string, json: unknown): Promise<void> {
    const v = validateManifest(json, HOST_API_VERSION);
    if (!v.ok) {
      if (v.reason.startsWith("incompatible")) this.recordIncompatible(dir, json, v.reason);
      else console.error(`[plugins] invalid manifest in ${dir}: ${v.reason}`);
      return;
    }
    const m = v.manifest;
    if (this.plugins.has(m.id)) {
      const existing = this.plugins.get(m.id);
      if (existing?.origin === "core") {
        console.warn(
          `[plugins] user plugin "${m.id}" in ${dir} collides with a core plugin — skipped (core wins)`,
        );
      } else {
        console.error(`[plugins] duplicate plugin id "${m.id}" in ${dir} — first one wins`);
      }
      return;
    }
    const rec: LoadedPlugin = {
      manifest: m,
      dir,
      origin: "user",
      status: "disabled",
      disposables: [],
      settingsSchema: [],
      settingsActions: new Map(),
      storage: createPluginStorage(this.deps.dataDir, m.id),
      secrets: createPluginSecrets(
        this.deps.secretsDir,
        m.id,
        this.deps.encrypt,
        this.deps.decrypt,
      ),
    };
    this.plugins.set(m.id, rec);
    if (!this.deps.isEnabled(m.id)) return; // listed as disabled; not imported
    await this.activatePlugin(rec);
  }

  /** An apiVersion mismatch is still LISTED (status incompatible) so the user
   *  can see why the plugin isn't running — if the manifest has a usable id. */
  private recordIncompatible(dir: string, json: unknown, reason: string): void {
    const m = json as Record<string, unknown>;
    const id = typeof m.id === "string" ? m.id : null;
    if (!id || this.plugins.has(id)) {
      console.error(`[plugins] incompatible plugin in ${dir}: ${reason}`);
      return;
    }
    this.plugins.set(id, {
      manifest: {
        id,
        name: typeof m.name === "string" ? m.name : id,
        version: typeof m.version === "string" ? m.version : "?",
        apiVersion: typeof m.apiVersion === "number" ? m.apiVersion : -1,
        entry: "",
      },
      dir,
      origin: "user",
      status: "incompatible",
      error: reason,
      disposables: [],
      settingsSchema: [],
      settingsActions: new Map(),
      storage: createPluginStorage(this.deps.dataDir, id),
      secrets: createPluginSecrets(this.deps.secretsDir, id, this.deps.encrypt, this.deps.decrypt),
    });
  }

  private async activatePlugin(rec: LoadedPlugin): Promise<void> {
    try {
      // User plugins run in a QuickJS sandbox (security boundary — no Node, no
      // import(), no Electron). The sandbox loads the ESM bundle, installs the
      // capability bridge, and calls activate(ctx). Provider registrations flow
      // through the bridge into the ProviderHub. The returned dispose tears down
      // the QuickJS context and hub registrations on deactivation.
      const sandboxDispose = await loadSandboxedPlugin({
        manifest: rec.manifest,
        pluginId: rec.manifest.id,
        dir: rec.dir,
        // Host owns the TLS/transport: build a fetch-shaped client per request
        // (allowSelfSigned routes through node:http(s) with a buffered Response).
        netFetch: async (url, init) => {
          const client = createNetClient({ allowSelfSigned: init?.allowSelfSigned });
          const res = await client(url, {
            method: init?.method,
            headers: init?.headers,
            body: init?.body,
          });
          return {
            ok: res.ok,
            status: res.status,
            headers: Object.fromEntries(res.headers),
            body: await res.text(),
          };
        },
        storage: rec.storage,
        secrets: rec.secrets,
        hub: this.deps.hub,
        notifySink: this.deps.notifySink,
        openExternal: this.deps.openExternal,
        library: this.deps.library,
        registerSettings: (schema) => {
          rec.settingsSchema = schema;
        },
        onSettingsAction: (key, handler) => {
          rec.settingsActions.set(key, handler);
        },
        trackDisposable: (d) => rec.disposables.push(d),
      });
      // Track the sandbox dispose so deactivatePlugin's disposeRegistrations
      // tears down the QuickJS context + hub registrations.
      rec.disposables.push(sandboxDispose);
      rec.status = "active";
      rec.error = undefined;
    } catch (err) {
      rec.status = "error";
      rec.error = err instanceof Error ? err.message : String(err);
      this.disposeRegistrations(rec); // drop any partial registrations
      rec.settingsSchema = [];
      rec.settingsActions.clear();
      console.error(`[plugins] ${rec.manifest.id} failed to activate:`, err);
    }
  }

  private async deactivatePlugin(rec: LoadedPlugin): Promise<void> {
    this.disposeRegistrations(rec);
    try {
      await rec.module?.deactivate?.();
    } catch (err) {
      console.error(`[plugins] ${rec.manifest.id} deactivate() threw:`, err);
    }
    rec.module = undefined;
    rec.settingsSchema = [];
    rec.settingsActions.clear();
  }

  private disposeRegistrations(rec: LoadedPlugin): void {
    for (const d of rec.disposables) {
      try {
        d.dispose();
      } catch (err) {
        console.error(`[plugins] ${rec.manifest.id} dispose() threw:`, err);
      }
    }
    rec.disposables = [];
  }

  private require(id: string): LoadedPlugin {
    const rec = this.plugins.get(id);
    if (!rec) throw new Error(`unknown plugin ${id}`);
    return rec;
  }
}
