/**
 * MobilePluginInstaller — GitHub install/uninstall for RN, mirroring desktop's
 * PluginInstaller (grounding §8) with RN I/O: injected `fetch`, the
 * `PluginFileStore` (expo-file-system), the `PluginIndex` (async-storage), an
 * injected `js-sha256` hasher, and a `reload` callback.
 *
 * Security (same guarantees as desktop):
 *  - validate `isSafePluginId` before any store path use,
 *  - reject `apiVersion !== HOST_API_VERSION`,
 *  - verify the release asset's sha256 (abort on mismatch),
 *  - fflate unzip with a WHITELIST: only `plugin.json` + the manifest `entry`
 *    are extracted, and each name must pass `isSafeEntryName` (zip-slip guard).
 */

import {
  isSafeEntryName,
  isSafePluginId,
  manifestRawUrls,
  parsePluginsManifest,
  parseRepoUrl,
  parseSha256File,
  releaseAssetUrl,
} from "@musex/core";
import type { PluginManifest } from "@musex/plugin-api";
import { unzipSync } from "fflate";
import type { PluginIndex, PluginSource } from "./plugin-index.js";
import type { PluginFileStore } from "./plugin-store.js";

/** The host plugin API version this app provides. Plugins must declare it. */
const HOST_API_VERSION = 2;

export interface AvailablePlugin {
  id: string;
  name: string;
  description?: string;
  version: string;
  apiVersion: number;
  compatible: boolean;
  installedVersion?: string;
}
export interface FetchManifestResult {
  repo: string;
  plugins: AvailablePlugin[];
}

export interface MobileInstallerDeps {
  fetch: typeof fetch;
  store: PluginFileStore;
  index: PluginIndex;
  /** hex sha256 of the asset bytes (injected js-sha256). */
  sha256: (b: Uint8Array) => string;
  /** Re-activate plugins after an install/uninstall changes the index. */
  reload: () => Promise<void>;
}

export class MobilePluginInstaller {
  constructor(private readonly deps: MobileInstallerDeps) {}

  async fetchManifest(repoUrl: string): Promise<FetchManifestResult> {
    const ref = parseRepoUrl(repoUrl);
    if (!ref) throw new Error("Not a valid GitHub repository URL");
    const manifest = parsePluginsManifest(await this.getJson(manifestRawUrls(ref)));
    return {
      repo: `${ref.owner}/${ref.repo}`,
      plugins: manifest.plugins.map((e) => ({
        id: e.id,
        name: e.name,
        version: e.version,
        apiVersion: e.apiVersion,
        compatible: e.apiVersion === HOST_API_VERSION,
        installedVersion: this.deps.index.get(e.id)?.source.version,
        ...(e.description !== undefined ? { description: e.description } : {}),
      })),
    };
  }

  async install(repoUrl: string, id: string): Promise<void> {
    if (!isSafePluginId(id)) throw new Error(`invalid plugin id: ${id}`);
    const ref = parseRepoUrl(repoUrl);
    if (!ref) throw new Error("Not a valid GitHub repository URL");
    const manifest = parsePluginsManifest(await this.getJson(manifestRawUrls(ref)));
    const entry = manifest.plugins.find((p) => p.id === id);
    if (!entry) throw new Error(`Plugin "${id}" is not in ${ref.owner}/${ref.repo}`);
    if (entry.apiVersion !== HOST_API_VERSION)
      throw new Error(
        `"${id}" needs plugin API v${entry.apiVersion}; this app provides v${HOST_API_VERSION}`,
      );

    const assetUrl = releaseAssetUrl(ref, entry.tag, entry.asset);
    const zip = await this.downloadBytes(assetUrl);
    const expected = parseSha256File(await this.downloadText(`${assetUrl}.sha256`));
    if (!expected) throw new Error("missing or invalid checksum file");
    const actual = this.deps.sha256(zip);
    if (actual !== expected) throw new Error("checksum mismatch — refusing to install");

    const files = unzipSync(zip);
    const pjRaw = files["plugin.json"];
    if (!pjRaw) throw new Error("bundle is missing plugin.json");
    const pj = JSON.parse(new TextDecoder().decode(pjRaw)) as Record<string, unknown>;
    if (pj.id !== id) throw new Error("bundle plugin.json id does not match");
    const entryName = typeof pj.entry === "string" ? pj.entry : "index.mjs";
    if (!isSafeEntryName(entryName)) throw new Error(`unsafe entry name: ${entryName}`);
    const entryData = files[entryName];
    if (!entryData) throw new Error(`bundle is missing its entry file "${entryName}"`);

    // Whitelist: ONLY plugin.json + the entry are written — never arbitrary
    // zip members. Each name is re-checked against isSafeEntryName (zip-slip).
    const out: Record<string, Uint8Array> = {};
    for (const name of ["plugin.json", entryName]) {
      if (!isSafeEntryName(name)) throw new Error(`unsafe entry name: ${name}`);
      const data = files[name];
      if (!data) throw new Error(`bundle missing ${name}`);
      out[name] = data;
    }
    await this.deps.store.writePlugin(id, out);

    const pluginManifest: PluginManifest = {
      id,
      name: typeof pj.name === "string" ? pj.name : entry.name,
      version: typeof pj.version === "string" ? pj.version : entry.version,
      apiVersion: entry.apiVersion,
      entry: entryName,
      ...(typeof pj.description === "string" ? { description: pj.description } : {}),
    };
    const source: PluginSource = { owner: ref.owner, repo: ref.repo, version: entry.version };
    await this.deps.index.upsert({
      id,
      manifest: pluginManifest,
      enabled: this.deps.index.get(id)?.enabled ?? true,
      source,
    });
    await this.deps.reload();
  }

  async uninstall(id: string): Promise<void> {
    if (!isSafePluginId(id)) throw new Error(`invalid plugin id: ${id}`);
    await this.deps.store.removePlugin(id);
    await this.deps.index.remove(id);
    await this.deps.reload();
  }

  private async getJson(urls: string[]): Promise<unknown> {
    let lastErr: unknown;
    for (const u of urls) {
      try {
        const res = await this.deps.fetch(u);
        if (res.ok) return await res.json();
        lastErr = new Error(`${u} → ${res.status}`);
      } catch (e) {
        lastErr = e;
      }
    }
    throw new Error(
      `Could not read plugins.json (${lastErr instanceof Error ? lastErr.message : String(lastErr)})`,
    );
  }

  private async downloadBytes(url: string): Promise<Uint8Array> {
    const res = await this.deps.fetch(url);
    if (!res.ok) throw new Error(`download failed: ${url} → ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }

  private async downloadText(url: string): Promise<string> {
    const res = await this.deps.fetch(url);
    if (!res.ok) throw new Error(`download failed: ${url} → ${res.status}`);
    return res.text();
  }
}
