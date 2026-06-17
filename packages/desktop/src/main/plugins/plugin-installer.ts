import { createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { unzipSync } from "fflate";
import {
  isSafeEntryName,
  manifestRawUrls,
  parsePluginsManifest,
  parseRepoUrl,
  parseSha256File,
  releaseAssetUrl,
} from "../../logic/plugin-source.js";
import { HOST_API_VERSION } from "./plugin-host.js";

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
export interface PluginSource {
  owner: string;
  repo: string;
  version: string;
}
export interface PluginInstallerDeps {
  fetch: typeof fetch;
  pluginsDir: string;
  reload: () => Promise<void>;
  getSource: (id: string) => PluginSource | undefined;
  setSource: (id: string, src: PluginSource | null) => void;
}

export class PluginInstaller {
  constructor(private readonly deps: PluginInstallerDeps) {}

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
        installedVersion: this.deps.getSource(e.id)?.version,
        ...(e.description !== undefined ? { description: e.description } : {}),
      })),
    };
  }

  async install(repoUrl: string, id: string): Promise<void> {
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
    const zip = await this.downloadBuffer(assetUrl);
    const expected = parseSha256File(await this.downloadText(`${assetUrl}.sha256`));
    if (!expected) throw new Error("missing or invalid checksum file");
    const actual = createHash("sha256").update(zip).digest("hex");
    if (actual !== expected) throw new Error("checksum mismatch — refusing to install");

    const files = unzipSync(new Uint8Array(zip));
    const pjRaw = files["plugin.json"];
    if (!pjRaw) throw new Error("bundle is missing plugin.json");
    const pj = JSON.parse(Buffer.from(pjRaw).toString("utf8")) as Record<string, unknown>;
    if (pj.id !== id) throw new Error("bundle plugin.json id does not match");
    const entryName = typeof pj.entry === "string" ? pj.entry : "index.mjs";
    if (!isSafeEntryName(entryName)) throw new Error(`unsafe entry name: ${entryName}`);
    if (!files[entryName]) throw new Error(`bundle is missing its entry file "${entryName}"`);

    const dir = join(this.deps.pluginsDir, id);
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    // Whitelist: write ONLY plugin.json + the entry — never arbitrary zip members.
    for (const name of ["plugin.json", entryName]) {
      if (!isSafeEntryName(name)) throw new Error(`unsafe entry name: ${name}`);
      const data = files[name];
      if (!data) throw new Error(`bundle missing ${name}`);
      await writeFile(join(dir, name), Buffer.from(data));
    }
    this.deps.setSource(id, { owner: ref.owner, repo: ref.repo, version: entry.version });
    await this.deps.reload();
  }

  async uninstall(id: string): Promise<void> {
    await rm(join(this.deps.pluginsDir, id), { recursive: true, force: true });
    this.deps.setSource(id, null);
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
  private async downloadBuffer(url: string): Promise<Buffer> {
    const res = await this.deps.fetch(url);
    if (!res.ok) throw new Error(`download failed: ${url} → ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
  private async downloadText(url: string): Promise<string> {
    const res = await this.deps.fetch(url);
    if (!res.ok) throw new Error(`download failed: ${url} → ${res.status}`);
    return res.text();
  }
}
