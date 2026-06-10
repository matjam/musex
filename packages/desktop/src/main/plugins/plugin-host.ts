import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type {
  Disposable,
  LibrarySearchResult,
  PluginContext,
  PluginManifest,
  SettingField,
  SettingsActionResult,
  TrackInfo,
} from "@musex/plugin-api";
import { validateManifest } from "../../logic/plugin-manifest.js";
import type { PluginInfo, PluginNotification, PluginSettings } from "../../shared/ipc-contract.js";
import { buildPluginContext, createPluginRegistry, type PluginRegistry } from "./plugin-context.js";
import {
  createPluginSecrets,
  createPluginStorage,
  type PluginSecrets,
  type PluginStorage,
} from "./plugin-store.js";

export const HOST_API_VERSION = 1;

export interface PluginHostDeps {
  /** Dirs whose subdirectories are plugins: `<sub>/plugin.json` or (dev repo
   *  convention) `<sub>/dist/plugin.json`. */
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
  };
}

interface PluginModule {
  activate?: (ctx: PluginContext) => void | Promise<void>;
  deactivate?: () => void | Promise<void>;
}

interface LoadedPlugin {
  manifest: PluginManifest;
  /** Directory containing plugin.json + the entry file. */
  dir: string;
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
 */
export class PluginHost {
  private readonly plugins = new Map<string, LoadedPlugin>();
  /** Bumped per (re)load; appended to import URLs to bust the ESM cache. */
  private generation = 0;
  readonly registry: PluginRegistry = createPluginRegistry();

  constructor(private readonly deps: PluginHostDeps) {}

  async loadAll(): Promise<void> {
    this.generation += 1;
    for (const found of await this.scan()) {
      await this.loadOne(found.dir, found.json);
    }
  }

  /** Dispose all registrations, deactivate, re-scan and re-import everything
   *  (fresh module instances via the generation query). */
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
      ...(rec.error !== undefined ? { error: rec.error } : {}),
    }));
  }

  async setEnabled(id: string, v: boolean): Promise<void> {
    const rec = this.require(id);
    this.deps.setEnabled(id, v);
    if (rec.status === "incompatible") return; // listed but never activatable
    if (v) {
      if (rec.status === "active") return;
      this.generation += 1; // fresh import on re-enable
      await this.activatePlugin(rec);
    } else {
      if (rec.status === "active") await this.deactivatePlugin(rec);
      rec.status = "disabled";
      rec.error = undefined;
    }
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
        // Direct layout (userData/plugins/<id>/plugin.json) or the dev repo
        // convention (<repo>/plugins/<name>/dist/plugin.json).
        for (const dir of [join(scanDir, sub), join(scanDir, sub, "dist")]) {
          const manifestPath = join(dir, "plugin.json");
          let raw: string;
          try {
            raw = await readFile(manifestPath, "utf8");
          } catch (err) {
            if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
              console.error(`[plugins] cannot read ${manifestPath}:`, err);
            }
            continue; // try the next candidate layout
          }
          try {
            found.push({ dir, json: JSON.parse(raw) });
          } catch (err) {
            console.error(`[plugins] malformed JSON in ${manifestPath}:`, err);
          }
          break; // manifest found (even if malformed) — don't also scan dist/
        }
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
      console.error(`[plugins] duplicate plugin id "${m.id}" in ${dir} — first one wins`);
      return;
    }
    const rec: LoadedPlugin = {
      manifest: m,
      dir,
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
      const entryUrl =
        pathToFileURL(join(rec.dir, rec.manifest.entry)).href + `?gen=${this.generation}`;
      const mod = (await import(/* @vite-ignore */ entryUrl)) as PluginModule;
      if (typeof mod.activate !== "function") {
        throw new Error("plugin entry has no activate() export");
      }
      rec.module = mod;
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
        this.registry,
        (d) => rec.disposables.push(d),
      );
      await mod.activate(ctx);
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
