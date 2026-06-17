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
  return {
    schemaVersion: 1,
    repo: "o/r",
    plugins: [
      {
        id: "demo",
        name: "Demo",
        apiVersion: 2,
        version,
        tag: `demo-v${version}`,
        asset: `demo-${version}.zip`,
      },
    ],
  };
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
    const zip = buildZip(
      { id: "demo", name: "Demo", version: "0.1.0", apiVersion: 2, entry: "index.mjs" },
      "index.mjs",
    );
    const sha = createHash("sha256").update(Buffer.from(zip)).digest("hex");
    const reload = vi.fn(async () => {});
    const sources = new Map<string, unknown>();
    const inst = new PluginInstaller({
      fetch: fakeFetch(zip, sha),
      pluginsDir: dir,
      reload,
      getSource: (id) => sources.get(id) as never,
      setSource: (id, s) => {
        s ? sources.set(id, s) : sources.delete(id);
      },
    });
    await inst.install("o/r", "demo");
    expect(JSON.parse(await readFile(join(dir, "demo", "plugin.json"), "utf8"))).toMatchObject({
      id: "demo",
    });
    expect(await readFile(join(dir, "demo", "index.mjs"), "utf8")).toContain("activate");
    expect(reload).toHaveBeenCalled();
    expect(sources.get("demo")).toMatchObject({ version: "0.1.0" });
  });

  it("rejects on checksum mismatch", async () => {
    const dir = await makeDir();
    const zip = buildZip(
      { id: "demo", name: "Demo", version: "0.1.0", apiVersion: 2, entry: "index.mjs" },
      "index.mjs",
    );
    const inst = new PluginInstaller({
      fetch: fakeFetch(zip, "0".repeat(64)),
      pluginsDir: dir,
      reload: vi.fn(async () => {}),
      getSource: () => undefined,
      setSource: () => {},
    });
    await expect(inst.install("o/r", "demo")).rejects.toThrow(/checksum/i);
  });

  it("rejects a zip-slip entry", async () => {
    const dir = await makeDir();
    const zip = zipSync({
      "plugin.json": new TextEncoder().encode(
        JSON.stringify({
          id: "demo",
          name: "Demo",
          version: "0.1.0",
          apiVersion: 2,
          entry: "../evil.mjs",
        }),
      ),
      "../evil.mjs": new Uint8Array(),
    });
    const sha = createHash("sha256").update(Buffer.from(zip)).digest("hex");
    const inst = new PluginInstaller({
      fetch: fakeFetch(zip, sha),
      pluginsDir: dir,
      reload: vi.fn(async () => {}),
      getSource: () => undefined,
      setSource: () => {},
    });
    await expect(inst.install("o/r", "demo")).rejects.toThrow(/safe entry|unsafe/i);
  });

  it("rejects a path-traversal plugin id on uninstall (no rm of arbitrary dirs)", async () => {
    const dir = await makeDir();
    const inst = new PluginInstaller({
      fetch: fakeFetch(new Uint8Array(), "0".repeat(64)),
      pluginsDir: dir,
      reload: vi.fn(async () => {}),
      getSource: () => undefined,
      setSource: () => {},
    });
    for (const bad of ["../evil", "..", "a/b", "foo/../bar", "."]) {
      await expect(inst.uninstall(bad)).rejects.toThrow(/invalid plugin id|unsafe/i);
    }
  });

  it("rejects a path-traversal plugin id on install (before any network/fs)", async () => {
    const dir = await makeDir();
    const inst = new PluginInstaller({
      fetch: fakeFetch(new Uint8Array(), "0".repeat(64)),
      pluginsDir: dir,
      reload: vi.fn(async () => {}),
      getSource: () => undefined,
      setSource: () => {},
    });
    await expect(inst.install("o/r", "../../evil")).rejects.toThrow(/invalid plugin id|unsafe/i);
  });
});
