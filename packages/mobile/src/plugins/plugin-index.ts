/**
 * PluginIndex — the persisted list of installed plugins + their GitHub sources,
 * stored in async-storage (`musex.plugin-index`). Mirrors the desktop installer's
 * electron-store `pluginSources`/installed list, on RN.
 *
 * Holds `InstalledPlugin` records ({ id, manifest, enabled, source }); the
 * manager reads `all()`/`isEnabled` to decide what to activate, the installer
 * `upsert`/`remove`s, and the Settings UI toggles `setEnabled`.
 */

import type { PluginManifest } from "@musex/plugin-api";
import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "musex.plugin-index";

/** Where a plugin came from (so the UI can show the repo + offer updates). */
export interface PluginSource {
  owner: string;
  repo: string;
  version: string;
}

export interface InstalledPlugin {
  id: string;
  manifest: PluginManifest;
  enabled: boolean;
  source: PluginSource;
}

export class PluginIndex {
  private map = new Map<string, InstalledPlugin>();

  async load(): Promise<void> {
    try {
      const raw = await AsyncStorage.getItem(KEY);
      if (raw) {
        for (const p of JSON.parse(raw) as InstalledPlugin[]) this.map.set(p.id, p);
      }
    } catch {
      /* fresh start */
    }
  }

  all(): InstalledPlugin[] {
    return [...this.map.values()];
  }

  get(id: string): InstalledPlugin | undefined {
    return this.map.get(id);
  }

  async upsert(p: InstalledPlugin): Promise<void> {
    this.map.set(p.id, p);
    await this.persist();
  }

  async remove(id: string): Promise<void> {
    this.map.delete(id);
    await this.persist();
  }

  async setEnabled(id: string, v: boolean): Promise<void> {
    const p = this.map.get(id);
    if (!p) return;
    p.enabled = v;
    await this.persist();
  }

  isEnabled(id: string): boolean {
    return this.map.get(id)?.enabled ?? false;
  }

  private async persist(): Promise<void> {
    try {
      await AsyncStorage.setItem(KEY, JSON.stringify(this.all()));
    } catch (err) {
      console.warn("[plugins] index persist failed", err);
    }
  }
}
