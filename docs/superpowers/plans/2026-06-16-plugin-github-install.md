# SP3 — In-app GitHub plugin install + remove bundled lidarr — Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Let users install/update/uninstall plugins from a GitHub repo URL in the desktop app, and stop shipping lidarr as a core plugin (it's now installed from `matjam/musex-plugins`). **Piece 3 of 4** — roadmap `docs/superpowers/specs/2026-06-16-plugin-distribution-roadmap.md`.

**Architecture / design.** A main-process `PluginInstaller` fetches a repo's `plugins.json` (raw, `main`→`master`), and on install downloads the release asset + its `.sha256`, **verifies the checksum**, **unzips with a zip-slip guard (whitelist `plugin.json` + the entry file, plain filenames only)** into `userData/plugins/<id>/`, records the source for updates, and calls `PluginHost.reloadAll()`. Pure parsing/validation lives in tested `logic/plugin-source.ts`. New IPC (`musex:plugins:fetchManifest|install|uninstall`) + an "Add from GitHub" UI in Settings → Plugins with a **full-trust confirmation** before install. Lidarr is removed as a core plugin (lastfm stays); the generic acquisition-provider UI (External Artist / Downloads / federated search) is untouched.

**Security (decided):** (1) checksum-verify every download against the published `.sha256` asset, abort on mismatch; (2) zip-slip guard — only extract `plugin.json` + the manifest `entry`, reject any name containing `/`, `\`, or `..`; (3) `apiVersion` must equal the host's before install; (4) install only from the manifest's pinned `tag`/`asset` (not arbitrary repo contents); (5) an explicit trust confirmation ("plugins run with full access; only install from sources you trust"). Already-full-trust model is unchanged; this adds integrity + consent for the new remote vector.

**Contract (from SP2, verified live):** manifest at `https://raw.githubusercontent.com/<owner>/<repo>/main/plugins.json` = `{schemaVersion:1, repo, plugins:[{id,name,description?,apiVersion,version,tag,asset}]}`; asset at `https://github.com/<owner>/<repo>/releases/download/<tag>/<asset>` (+ `<asset>.sha256`); zip root = `plugin.json` + `index.mjs`.

**Tech:** Electron main (Node fetch + node:crypto + fflate), React renderer, vitest. **Branch:** `feature/plugin-github-install`.

**Integration points (verified):** IPC `musex:plugins:*` in `shared/ipc-contract.ts`; preload bridge in `preload/index.ts`; handlers in `main/ipc.ts` (`rt.plugins.*`); `PluginHost.reloadAll()` + `scanDirs:[userData/plugins]`; persistence `electron-store` in `main/adapters/persistence.ts` (pattern: `isPluginEnabled`/`setPluginEnabled`, `PersistedState` defaults); Settings UI `PluginsOverview`/`PluginsOverviewRow` in `renderer/.../views/SettingsView.tsx` (fetches `window.musex.pluginsList()`); `HOST_API_VERSION` exported from `main/plugins/plugin-host.ts`; Runtime builds the host in `main/runtime.ts`. No zip lib yet → add **fflate**.

---

## Task 1: fflate dep + pure `plugin-source` logic

**Files:** Modify `packages/desktop/package.json`; Create `packages/desktop/src/logic/plugin-source.ts` + `.test.ts`.

- [ ] **Step 1: add fflate** — `pnpm --filter @musex/desktop add fflate` (run `npm view fflate version` first; use latest stable). It's a runtime dep (used in main).

- [ ] **Step 2: write the failing test** `packages/desktop/src/logic/plugin-source.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  isSafeEntryName,
  manifestRawUrls,
  parsePluginsManifest,
  parseRepoUrl,
  parseSha256File,
  releaseAssetUrl,
} from "./plugin-source";

describe("parseRepoUrl", () => {
  it("accepts the common forms", () => {
    for (const s of [
      "https://github.com/matjam/musex-plugins",
      "https://github.com/matjam/musex-plugins.git",
      "github.com/matjam/musex-plugins/",
      "matjam/musex-plugins",
    ]) {
      expect(parseRepoUrl(s)).toEqual({ owner: "matjam", repo: "musex-plugins" });
    }
  });
  it("rejects junk", () => {
    for (const s of ["", "not a url", "https://example.com/x", "matjam"]) {
      expect(parseRepoUrl(s)).toBeNull();
    }
  });
});

describe("urls", () => {
  it("builds raw + asset urls", () => {
    const ref = { owner: "matjam", repo: "musex-plugins" };
    expect(manifestRawUrls(ref)[0]).toBe(
      "https://raw.githubusercontent.com/matjam/musex-plugins/main/plugins.json",
    );
    expect(releaseAssetUrl(ref, "lidarr-v0.1.0", "lidarr-0.1.0.zip")).toBe(
      "https://github.com/matjam/musex-plugins/releases/download/lidarr-v0.1.0/lidarr-0.1.0.zip",
    );
  });
});

describe("parsePluginsManifest", () => {
  it("parses a valid manifest", () => {
    const m = parsePluginsManifest({
      schemaVersion: 1,
      repo: "matjam/musex-plugins",
      plugins: [
        { id: "lidarr", name: "Lidarr", description: "x", apiVersion: 1, version: "0.1.0", tag: "lidarr-v0.1.0", asset: "lidarr-0.1.0.zip" },
      ],
    });
    expect(m.plugins[0]).toMatchObject({ id: "lidarr", version: "0.1.0", tag: "lidarr-v0.1.0" });
  });
  it("rejects bad schema / id / missing fields", () => {
    expect(() => parsePluginsManifest({ schemaVersion: 2, plugins: [] })).toThrow();
    expect(() => parsePluginsManifest({ schemaVersion: 1, plugins: [{ id: "Bad ID", name: "x", apiVersion: 1, version: "1", tag: "t", asset: "a" }] })).toThrow();
    expect(() => parsePluginsManifest({ schemaVersion: 1, plugins: [{ id: "ok", apiVersion: 1, version: "1", tag: "t", asset: "a" }] })).toThrow();
  });
});

describe("parseSha256File", () => {
  it("extracts the hex", () => {
    expect(parseSha256File("e6172048c954b14d7515fb7bd82cf2cc6b0b40f81f177739bf01f6dfbea12eca  lidarr-0.1.0.zip")).toBe(
      "e6172048c954b14d7515fb7bd82cf2cc6b0b40f81f177739bf01f6dfbea12eca",
    );
    expect(parseSha256File("nope")).toBeNull();
  });
});

describe("isSafeEntryName", () => {
  it("allows plain names, rejects traversal", () => {
    expect(isSafeEntryName("index.mjs")).toBe(true);
    expect(isSafeEntryName("plugin.json")).toBe(true);
    for (const n of ["../evil", "a/b", "a\\b", "..", "", "."]) expect(isSafeEntryName(n)).toBe(false);
  });
});
```

Run: `pnpm --filter @musex/desktop test plugin-source` → FAIL (module missing).

- [ ] **Step 3: implement `plugin-source.ts`** (pure; no Node imports):

```typescript
export interface RepoRef {
  owner: string;
  repo: string;
}
export interface ManifestEntry {
  id: string;
  name: string;
  description?: string;
  apiVersion: number;
  version: string;
  tag: string;
  asset: string;
}
export interface RepoManifest {
  schemaVersion: number;
  repo: string;
  plugins: ManifestEntry[];
}

const NAME_RE = /^[A-Za-z0-9._-]+$/;
const ID_RE = /^[a-z0-9-]+$/;

/** Accepts `https://github.com/owner/repo[.git][/]`, `github.com/owner/repo`, or `owner/repo`. */
export function parseRepoUrl(input: string): RepoRef | null {
  const s = input.trim().replace(/\.git$/, "").replace(/\/+$/, "");
  const m = s.match(/^(?:https?:\/\/)?(?:github\.com\/)?([^/\s]+)\/([^/\s]+)$/);
  if (!m) return null;
  const owner = m[1];
  const repo = m[2];
  if (!NAME_RE.test(owner) || !NAME_RE.test(repo)) return null;
  return { owner, repo };
}

export function manifestRawUrls(ref: RepoRef): string[] {
  return ["main", "master"].map(
    (b) => `https://raw.githubusercontent.com/${ref.owner}/${ref.repo}/${b}/plugins.json`,
  );
}

export function releaseAssetUrl(ref: RepoRef, tag: string, asset: string): string {
  return `https://github.com/${ref.owner}/${ref.repo}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(asset)}`;
}

export function parsePluginsManifest(json: unknown): RepoManifest {
  if (typeof json !== "object" || json === null || Array.isArray(json))
    throw new Error("manifest is not an object");
  const m = json as Record<string, unknown>;
  if (m.schemaVersion !== 1) throw new Error(`unsupported manifest schemaVersion: ${String(m.schemaVersion)}`);
  if (!Array.isArray(m.plugins)) throw new Error("manifest.plugins must be an array");
  const plugins = m.plugins.map((p, i): ManifestEntry => {
    if (typeof p !== "object" || p === null) throw new Error(`plugin[${i}] is not an object`);
    const e = p as Record<string, unknown>;
    const str = (k: string): string => {
      const v = e[k];
      if (typeof v !== "string" || v === "") throw new Error(`plugin[${i}].${k} must be a non-empty string`);
      return v;
    };
    const id = str("id");
    if (!ID_RE.test(id)) throw new Error(`plugin[${i}].id must match ^[a-z0-9-]+$`);
    if (typeof e.apiVersion !== "number") throw new Error(`plugin[${i}].apiVersion must be a number`);
    return {
      id,
      name: str("name"),
      apiVersion: e.apiVersion,
      version: str("version"),
      tag: str("tag"),
      asset: str("asset"),
      ...(typeof e.description === "string" ? { description: e.description } : {}),
    };
  });
  return { schemaVersion: 1, repo: typeof m.repo === "string" ? m.repo : "", plugins };
}

export function parseSha256File(text: string): string | null {
  const m = text.trim().match(/^([a-fA-F0-9]{64})\b/);
  return m ? m[1].toLowerCase() : null;
}

/** A zip entry safe to extract: a plain filename, no separators or traversal. */
export function isSafeEntryName(name: string): boolean {
  return name.length > 0 && !name.includes("/") && !name.includes("\\") && name !== "." && name !== "..";
}
```

Run: `pnpm --filter @musex/desktop test plugin-source` → PASS. Then `biome check --write` the two files + `tsc -p tsconfig.node.json --noEmit`.

- [ ] **Step 4: Commit** — `git add -A && git commit -m "feat(desktop): fflate + pure plugin-source logic (repo URL, manifest, checksum, zip-slip guard)"`

---

## Task 2: PluginInstaller + persistence + IPC + preload + Runtime wiring

**Files:** Create `packages/desktop/src/main/plugins/plugin-installer.ts` + `.test.ts`; Modify `main/adapters/persistence.ts`, `shared/ipc-contract.ts`, `preload/index.ts`, `main/ipc.ts`, `main/runtime.ts`.

- [ ] **Step 1: persistence — add a plugin-source store.** In `persistence.ts`, add `pluginSources: {}` to `PersistedState` defaults (type `Record<string, { owner: string; repo: string; version: string }>`), and methods:

```typescript
  getPluginSource(id: string) {
    return store.get("pluginSources")[id];
  },
  setPluginSource(id: string, src: { owner: string; repo: string; version: string } | null): void {
    const all = { ...store.get("pluginSources") };
    if (src) all[id] = src;
    else delete all[id];
    store.set("pluginSources", all);
  },
```

- [ ] **Step 2: write the failing installer test** `plugin-installer.test.ts` — uses fflate to build a zip in-memory, a fake `fetch` serving manifest+zip+sha256, and a temp `pluginsDir`:

```typescript
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync } from "fflate";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PluginInstaller } from "./plugin-installer";

function buildZip(pluginJson: object, entry: string): Uint8Array {
  return zipSync({
    "plugin.json": new TextEncoder().encode(JSON.stringify(pluginJson)),
    [entry]: new TextEncoder().encode("export function activate(){}"),
  });
}

function manifest(version = "0.1.0") {
  return { schemaVersion: 1, repo: "o/r", plugins: [{ id: "demo", name: "Demo", apiVersion: 1, version, tag: `demo-v${version}`, asset: `demo-${version}.zip` }] };
}

const tmps: string[] = [];
afterEach(async () => {
  for (const d of tmps.splice(0)) await rm(d, { recursive: true, force: true });
});

async function makeDir() {
  const d = await mkdtemp(join(tmpdir(), "musex-plugins-"));
  tmps.push(d);
  return d;
}

function fakeFetch(zip: Uint8Array, sha: string, ver = "0.1.0"): typeof fetch {
  return (async (url: string) => {
    const u = String(url);
    if (u.endsWith("plugins.json")) return new Response(JSON.stringify(manifest(ver)));
    if (u.endsWith(".zip.sha256")) return new Response(`${sha}  demo-${ver}.zip`);
    if (u.endsWith(".zip")) return new Response(zip);
    return new Response("", { status: 404 });
  }) as unknown as typeof fetch;
}

describe("PluginInstaller", () => {
  it("installs a verified plugin into pluginsDir and reloads", async () => {
    const dir = await makeDir();
    const zip = buildZip({ id: "demo", name: "Demo", version: "0.1.0", apiVersion: 1, entry: "index.mjs" }, "index.mjs");
    const sha = createHash("sha256").update(Buffer.from(zip)).digest("hex");
    const reload = vi.fn(async () => {});
    const sources = new Map<string, unknown>();
    const inst = new PluginInstaller({
      fetch: fakeFetch(zip, sha),
      pluginsDir: dir,
      reload,
      getSource: (id) => sources.get(id) as never,
      setSource: (id, s) => { s ? sources.set(id, s) : sources.delete(id); },
    });
    await inst.install("o/r", "demo");
    expect(JSON.parse(await readFile(join(dir, "demo", "plugin.json"), "utf8"))).toMatchObject({ id: "demo" });
    expect(await readFile(join(dir, "demo", "index.mjs"), "utf8")).toContain("activate");
    expect(reload).toHaveBeenCalled();
    expect(sources.get("demo")).toMatchObject({ version: "0.1.0" });
  });

  it("rejects on checksum mismatch", async () => {
    const dir = await makeDir();
    const zip = buildZip({ id: "demo", name: "Demo", version: "0.1.0", apiVersion: 1, entry: "index.mjs" }, "index.mjs");
    const inst = new PluginInstaller({
      fetch: fakeFetch(zip, "0".repeat(64)),
      pluginsDir: dir, reload: vi.fn(async () => {}), getSource: () => undefined, setSource: () => {},
    });
    await expect(inst.install("o/r", "demo")).rejects.toThrow(/checksum/i);
  });

  it("rejects a zip-slip entry", async () => {
    const dir = await makeDir();
    const zip = zipSync({ "plugin.json": new TextEncoder().encode(JSON.stringify({ id: "demo", name: "Demo", version: "0.1.0", apiVersion: 1, entry: "../evil.mjs" })), "../evil.mjs": new Uint8Array() });
    const sha = createHash("sha256").update(Buffer.from(zip)).digest("hex");
    const inst = new PluginInstaller({ fetch: fakeFetch(zip, sha), pluginsDir: dir, reload: vi.fn(async () => {}), getSource: () => undefined, setSource: () => {} });
    await expect(inst.install("o/r", "demo")).rejects.toThrow(/safe entry|unsafe/i);
  });
});
```

Run: `pnpm --filter @musex/desktop test plugin-installer` → FAIL.

- [ ] **Step 3: implement `plugin-installer.ts`** (exact code — main process):

```typescript
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
      throw new Error(`"${id}" needs plugin API v${entry.apiVersion}; this app provides v${HOST_API_VERSION}`);

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
    throw new Error(`Could not read plugins.json (${lastErr instanceof Error ? lastErr.message : String(lastErr)})`);
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
```

Run the installer test → PASS. (If `HOST_API_VERSION` isn't exported from `plugin-host.ts`, export it.)

- [ ] **Step 4: IPC contract.** In `shared/ipc-contract.ts` add channels + DTOs:

```typescript
  pluginsFetchManifest: "musex:plugins:fetchManifest", // (repoUrl) -> FetchManifestResult
  pluginsInstall: "musex:plugins:install", // (repoUrl, id) -> void
  pluginsUninstall: "musex:plugins:uninstall", // (id) -> void
```

```typescript
export interface AvailablePluginDto {
  id: string;
  name: string;
  description?: string;
  version: string;
  apiVersion: number;
  compatible: boolean;
  installedVersion?: string;
}
export interface FetchManifestResultDto {
  repo: string;
  plugins: AvailablePluginDto[];
}
```

- [ ] **Step 5: preload** — add to `preload/index.ts`:

```typescript
  pluginsFetchManifest: (repoUrl: string) => ipcRenderer.invoke(IPC.pluginsFetchManifest, repoUrl),
  pluginsInstall: (repoUrl: string, id: string) => ipcRenderer.invoke(IPC.pluginsInstall, repoUrl, id),
  pluginsUninstall: (id: string) => ipcRenderer.invoke(IPC.pluginsUninstall, id),
```

(Update the `window.musex` type wherever the preload API type lives.)

- [ ] **Step 6: Runtime** — in `main/runtime.ts`, construct the installer after the PluginHost:

```typescript
    this.pluginInstaller = new PluginInstaller({
      fetch: globalThis.fetch,
      pluginsDir: path.join(app.getPath("userData"), "plugins"),
      reload: () => this.plugins.reloadAll(),
      getSource: (id) => persistence.getPluginSource(id),
      setSource: (id, src) => persistence.setPluginSource(id, src),
    });
```

(Add `pluginInstaller: PluginInstaller` field + import.)

- [ ] **Step 7: IPC handlers** — in `main/ipc.ts` next to the other `plugins*` handlers:

```typescript
  ipcMain.handle(IPC.pluginsFetchManifest, (_e, repoUrl: string) => {
    if (typeof repoUrl !== "string" || !repoUrl) throw new Error("invalid repo url");
    return rt.pluginInstaller.fetchManifest(repoUrl);
  });
  ipcMain.handle(IPC.pluginsInstall, (_e, repoUrl: string, id: string) => {
    if (typeof repoUrl !== "string" || !repoUrl) throw new Error("invalid repo url");
    if (typeof id !== "string" || !id) throw new Error("invalid plugin id");
    return rt.pluginInstaller.install(repoUrl, id);
  });
  ipcMain.handle(IPC.pluginsUninstall, (_e, id: string) => {
    if (typeof id !== "string" || !id) throw new Error("invalid plugin id");
    return rt.pluginInstaller.uninstall(id);
  });
```

- [ ] **Step 8: verify + commit.** `pnpm --filter @musex/desktop test` (installer + existing pass), `biome check --write` touched files, `tsc -p tsconfig.node.json --noEmit`. Commit: `feat(desktop): PluginInstaller (fetch/verify/unzip) + IPC + persistence + Runtime`.

---

## Task 3: "Add from GitHub" UI + uninstall

**Files:** Modify `renderer/src/ui/views/SettingsView.tsx` (and the renderer `window.musex` type if separate).

- [ ] **Step 1: extend `PluginsOverview`** with an install sub-section above the installed list:
  - State: `repoUrl` (input), `available: FetchManifestResultDto | null`, `busy`/`error`.
  - A row with a text input ("owner/repo or GitHub URL") + a "Browse" button → `window.musex.pluginsFetchManifest(repoUrl)` → set `available`; show errors inline.
  - For each `available.plugins`: a row with name + version + description; a button that is **"Install"** (not installed), **"Update"** (installedVersion present and `!==` version), or disabled **"Installed"** (equal). Incompatible (`!compatible`) → disabled with an "needs newer app" note. Install/Update → a **trust confirm** (`window.confirm("Plugins run with full access to your computer. Only install plugins from sources you trust.\n\nInstall <name> from <repo>?")`) → `window.musex.pluginsInstall(repoUrl, id)` → on success refresh `pluginsList()` + re-Browse.
- [ ] **Step 2: add Uninstall** to `PluginsOverviewRow` (user plugins only): a small "Uninstall" button → `window.confirm` → `window.musex.pluginsUninstall(id)` → `onChanged()`.
- [ ] **Step 3:** reuse existing `.settings-row`/`.settings-btn`/input classes; add minimal CSS only if needed. Verify `tsc -p tsconfig.json --noEmit` + `biome check --write`.
- [ ] **Step 4: Commit** — `feat(desktop): Settings → Plugins "Add from GitHub" install/update/uninstall UI`.

---

## Task 4: Remove bundled lidarr (lastfm stays)

**Files:** `main/plugins/core-plugins.ts`, `electron.vite.config.ts`, `packages/desktop/package.json`, delete `plugins/lidarr/`, scrub strings, `README.md`.

- [ ] **Step 1:** `core-plugins.ts` — remove `import * as lidarr` and the lidarr `CORE_PLUGINS` entry (keep lastfm).
- [ ] **Step 2:** `electron.vite.config.ts` — remove `"@musex/plugin-lidarr"` from `externalizeDepsPlugin.exclude`.
- [ ] **Step 3:** `packages/desktop/package.json` — remove the `"@musex/plugin-lidarr": "workspace:*"` dependency.
- [ ] **Step 4:** `git rm -r plugins/lidarr` (it now lives in `matjam/musex-plugins`). The pnpm workspace will drop it on next install.
- [ ] **Step 5:** scrub user-facing "Lidarr" strings → generic "an acquisition plugin": `renderer/.../views/SettingsView.tsx` (the discovery/expansion descriptions), and update the comments in `ExternalArtistView.tsx`, `DownloadsView.tsx`, `SearchView.tsx`, `hooks/useAcquisitionAvailable.ts`, `main/runtime.ts`, `main/plugins/plugin-host.ts`, `main/expansion/coordinator.ts`. Keep the generic acquisition UI working — only the lidarr *name* goes.
- [ ] **Step 6:** `README.md` — change the Lidarr lines to "install acquisition plugins (e.g. Lidarr) from a plugin repo via Settings → Plugins → Add from GitHub."
- [ ] **Step 7:** `pnpm install` (drops the lidarr workspace dep) then `pnpm gen:licenses` (lidarr removed, fflate added). Verify `pnpm --filter @musex/desktop exec tsc` + build still resolve (no dangling `@musex/plugin-lidarr` import).
- [ ] **Step 8: Commit** — `refactor(desktop): remove bundled lidarr core plugin (now installable from musex-plugins)`.

---

## Task 5: Full check, docs, PR

- [ ] **Step 1:** `pnpm check` green (fix repo-wide biome with `biome check --write .`).
- [ ] **Step 2:** `CLAUDE.md` — update the plugin-architecture bullet: lidarr is no longer a core plugin (lastfm still is); plugins install from a GitHub repo via the installer (`main/plugins/plugin-installer.ts`, pure logic `logic/plugin-source.ts`, fflate unzip, checksum + zip-slip guards, trust confirm); persistence `pluginSources`; IPC `musex:plugins:fetchManifest|install|uninstall`; `~/src/musex-plugins` is the first repo. Mark SP3 done in the roadmap arc; update the project description (drop "Lidarr integration" → "acquisition plugins").
- [ ] **Step 3:** Commit docs; push; open PR titled `feat: install plugins from a GitHub repo + remove bundled lidarr` — body links the roadmap (piece 3/4), summarizes the installer + security (checksum/zip-slip/apiVersion/trust), notes that **lidarr is now installed from `matjam/musex-plugins`** (migration: existing users re-install it from Settings → Plugins → Add from GitHub), and lists the manual verification (paste `matjam/musex-plugins` → install lidarr → configure → acquisition works; uninstall works).

## Self-review (controller)
- Coverage: install/update/uninstall (T2/T3), security checksum+zip-slip+apiVersion+trust (T1/T2/T3), lidarr removal (T4), docs (T5). ✓
- Types: `RepoRef`/`ManifestEntry` (T1) used by installer (T2); `AvailablePlugin`/DTO shared shape (T2/T4 ipc + T3 UI); `HOST_API_VERSION` exported (T2). ✓
- Security: checksum verified before extract; only `plugin.json`+entry written; names guarded; apiVersion gate; trust confirm. ✓
- Manual-only: the live install against the real repo is user-verified on desktop; everything else is unit-tested + `pnpm check`.
