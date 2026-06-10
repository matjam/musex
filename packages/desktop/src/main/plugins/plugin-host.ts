import { access, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type {
  Disposable,
  LibrarySearchResult,
  PluginContext,
  PluginEvents,
  PluginManifest,
  Section,
  SectionContext,
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

/** Per-provider budget for section/detail fan-outs — a slow plugin must never
 *  hold the whole view hostage. */
const PROVIDER_TIMEOUT_MS = 8_000;

/** Reject after `ms` (the underlying promise keeps running; we just stop
 *  waiting). The timer is cleared on settle so it never holds the process. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

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
  /** Per-provider fan-out budget override (tests); defaults to 8s. */
  providerTimeoutMs?: number;
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

  /** Fan an event out to every subscriber of that event, isolating failures —
   *  a throwing plugin handler is logged and never blocks the rest. */
  emitEvent<K extends keyof PluginEvents>(event: K, payload: PluginEvents[K]): void {
    // Copy: a handler may dispose (or add) subscriptions while we iterate.
    for (const sub of [...this.registry.eventSubscribers]) {
      if (sub.event !== event) continue;
      try {
        sub.handler(payload);
      } catch (err) {
        console.error(`[plugins] ${sub.pluginId} "${event}" handler threw:`, err);
      }
    }
  }

  // ── contribution surfaces (sections / track actions / track detail) ──────

  /** Fan out to every section provider registered for `target`, isolating
   *  failures: a throwing or slow (>timeout) provider is logged and skipped. */
  async getSections(
    target: "discover" | "home",
    ctx: SectionContext,
  ): Promise<{ pluginId: string; sections: Section[] }[]> {
    const timeoutMs = this.deps.providerTimeoutMs ?? PROVIDER_TIMEOUT_MS;
    const providers = this.registry.sectionProviders.filter((p) => p.target === target);
    const results = await Promise.all(
      providers.map(async (p) => {
        try {
          const sections = await withTimeout(p.provider.getSections(ctx), timeoutMs);
          return { pluginId: p.pluginId, sections };
        } catch (err) {
          console.error(`[plugins] ${p.pluginId} section provider "${p.provider.id}" failed:`, err);
          return null;
        }
      }),
    );
    return results.filter((r) => r !== null);
  }

  listTrackActions(): { pluginId: string; id: string; label: string; icon?: string }[] {
    return this.registry.trackActions.map((r) => ({
      pluginId: r.pluginId,
      id: r.action.id,
      label: r.action.label,
      ...(r.action.icon !== undefined ? { icon: r.action.icon } : {}),
    }));
  }

  /** Unknown action id → throw; a throwing action is rethrown with the plugin
   *  id prefixed so the renderer's error surface says who failed. */
  async invokeTrackAction(actionId: string, track: TrackInfo): Promise<void> {
    const entry = this.registry.trackActions.find((r) => r.action.id === actionId);
    if (!entry) throw new Error(`unknown track action "${actionId}"`);
    try {
      await entry.action.onInvoke(track);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`[plugin:${entry.pluginId}] track action "${actionId}" failed: ${msg}`);
    }
  }

  /** Fan out to every track-detail provider; failures/timeouts are logged and
   *  skipped, and providers returning null (no data) are dropped. */
  async getTrackDetails(
    track: TrackInfo,
  ): Promise<{ pluginId: string; title: string; rows: { label: string; value: string }[] }[]> {
    const timeoutMs = this.deps.providerTimeoutMs ?? PROVIDER_TIMEOUT_MS;
    const results = await Promise.all(
      this.registry.trackDetailProviders.map(async (p) => {
        try {
          const detail = await withTimeout(p.provider.getDetail(track), timeoutMs);
          return detail === null ? null : { pluginId: p.pluginId, ...detail };
        } catch (err) {
          console.error(
            `[plugins] ${p.pluginId} track-detail provider "${p.provider.id}" failed:`,
            err,
          );
          return null;
        }
      }),
    );
    return results.filter((r) => r !== null);
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
        // Dev repo convention FIRST (<repo>/plugins/<name>/dist/plugin.json —
        // source packages also keep plugin.json at their root, which must NOT
        // win or the entry resolves beside the source instead of the bundle),
        // then the direct layout (userData/plugins/<id>/plugin.json).
        for (const dir of [join(scanDir, sub, "dist"), join(scanDir, sub)]) {
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
          let json: unknown;
          try {
            json = JSON.parse(raw);
          } catch (err) {
            console.error(`[plugins] malformed JSON in ${manifestPath}:`, err);
            break; // manifest found but unusable — don't fall through to another layout
          }
          // A manifest whose entry file is absent is not a usable candidate
          // (e.g. a source-tree plugin.json before `pnpm build:plugins` ran) —
          // keep looking rather than failing at import time.
          const entry = (json as Record<string, unknown>).entry;
          if (typeof entry === "string" && entry.length > 0) {
            try {
              await access(join(dir, entry));
            } catch {
              console.error(
                `[plugins] ${manifestPath}: entry "${entry}" not found next to the manifest` +
                  ` (unbuilt plugin? run pnpm build:plugins)`,
              );
              continue;
            }
          }
          found.push({ dir, json });
          break;
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
