import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PluginNotification } from "../../shared/ipc-contract";
import { PluginHost, type PluginHostDeps } from "./plugin-host";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "musex-plugin-host-"));
  delete (globalThis as Record<string, unknown>).__activations;
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const GOOD_ENTRY = `export function activate(ctx) {
  ctx.registerSettings([
    { kind: "toggle", key: "x", label: "X" },
    { kind: "text", key: "apiKey", label: "API key" },
    { kind: "password", key: "secret", label: "Secret" },
    { kind: "action", key: "connect", label: "Connect" },
  ]);
  ctx.onSettingsAction("connect", async () => ({ ok: true, message: "connected" }));
  ctx.events.on("trackStarted", () => {});
  ctx.ui.contributeTrackAction({ id: "a", label: "A", onInvoke: async () => {} });
  globalThis.__activations = (globalThis.__activations ?? 0) + 1;
}
export function deactivate() {
  globalThis.__deactivated = true;
}
`;

async function writePlugin(
  id: string,
  entry: string,
  manifest?: Record<string, unknown>,
  opts?: { dist?: boolean },
): Promise<void> {
  const dir = opts?.dist ? join(root, "scan", id, "dist") : join(root, "scan", id);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "plugin.json"),
    JSON.stringify(
      manifest ?? { id, name: id, version: "1.0.0", apiVersion: 1, entry: "index.mjs" },
    ),
  );
  await writeFile(join(dir, "index.mjs"), entry);
}

function makeHost(overrides: Partial<PluginHostDeps> = {}) {
  const disabled = new Set<string>();
  const notifications: PluginNotification[] = [];
  const opened: string[] = [];
  const host = new PluginHost({
    scanDirs: [join(root, "scan")],
    dataDir: join(root, "data"),
    secretsDir: join(root, "secrets"),
    encrypt: async (s) => s,
    decrypt: async (s) => s,
    isEnabled: (id) => !disabled.has(id),
    setEnabled: (id, v) => {
      if (v) disabled.delete(id);
      else disabled.add(id);
    },
    notifySink: (p) => notifications.push(p),
    openExternal: (url) => opened.push(url),
    library: {
      search: async () => ({ artists: [], albums: [], tracks: [] }),
      recentlyPlayed: async () => [],
      topArtists: async () => [],
    },
    ...overrides,
  });
  return { host, disabled, notifications, opened };
}

function activations(): number {
  return ((globalThis as Record<string, unknown>).__activations as number | undefined) ?? 0;
}

describe("PluginHost", () => {
  it("loads, activates, and exposes the registered settings schema", async () => {
    await writePlugin("good", GOOD_ENTRY);
    const { host } = makeHost();
    await host.loadAll();

    expect(host.list()).toEqual([{ id: "good", name: "good", version: "1.0.0", status: "active" }]);
    expect(activations()).toBe(1);

    const settings = await host.getSettings("good");
    expect(settings.schema.map((f) => f.key)).toEqual(["x", "apiKey", "secret", "connect"]);
    // password presence flag, no value for actions
    expect(settings.values).toEqual({ x: null, apiKey: null, secret: { set: false } });

    // registrations landed in the registry for Tasks 2/4
    expect(host.registry.eventSubscribers).toHaveLength(1);
    expect(host.registry.trackActions).toHaveLength(1);
  });

  it("finds plugins under the dev <sub>/dist/ layout", async () => {
    await writePlugin("devkit", GOOD_ENTRY, undefined, { dist: true });
    const { host } = makeHost();
    await host.loadAll();
    expect(host.list()[0]?.status).toBe("active");
  });

  it("prefers dist/ over a root source manifest (real first-party package layout)", async () => {
    // Source packages keep plugin.json at the package root (no entry beside it)
    // AND ship the built dist/{plugin.json,index.mjs}. The root manifest must
    // not win — regression for lastfm failing with ERR_MODULE_NOT_FOUND.
    await writePlugin("pkg", GOOD_ENTRY, undefined, { dist: true });
    const rootDir = join(root, "scan", "pkg");
    await writeFile(
      join(rootDir, "plugin.json"),
      JSON.stringify({
        id: "pkg",
        name: "pkg",
        version: "1.0.0",
        apiVersion: 1,
        entry: "index.mjs",
      }),
    );
    // note: no index.mjs at the package root
    const { host } = makeHost();
    await host.loadAll();
    expect(host.list()[0]?.status).toBe("active");
  });

  it("skips a manifest whose entry file is missing (unbuilt source tree)", async () => {
    const dir = join(root, "scan", "unbuilt");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "plugin.json"),
      JSON.stringify({
        id: "unbuilt",
        name: "u",
        version: "1.0.0",
        apiVersion: 1,
        entry: "index.mjs",
      }),
    );
    const { host } = makeHost();
    await host.loadAll();
    expect(host.list()).toHaveLength(0); // not listed as errored — just not a usable candidate
  });

  it("isolates a throwing plugin: it errors, others stay active", async () => {
    await writePlugin("bad", `export function activate() { throw new Error("boom"); }`);
    await writePlugin("good", GOOD_ENTRY);
    const { host } = makeHost();
    await host.loadAll();

    const byId = new Map(host.list().map((p) => [p.id, p]));
    expect(byId.get("bad")).toMatchObject({ status: "error", error: "boom" });
    expect(byId.get("good")?.status).toBe("active");
  });

  it("marks an entry without activate() as errored", async () => {
    await writePlugin("noop", `export const nothing = 1;`);
    const { host } = makeHost();
    await host.loadAll();
    expect(host.list()[0]).toMatchObject({ status: "error" });
    expect(host.list()[0]?.error).toContain("activate");
  });

  it("lists an apiVersion mismatch as incompatible without importing it", async () => {
    await writePlugin("future", `globalThis.__futureImported = true;`, {
      id: "future",
      name: "Future",
      version: "9.0.0",
      apiVersion: 2,
      entry: "index.mjs",
    });
    const { host } = makeHost();
    await host.loadAll();
    expect(host.list()[0]).toMatchObject({
      id: "future",
      status: "incompatible",
      error: "incompatible: requires API v2, host is v1",
    });
    expect((globalThis as Record<string, unknown>).__futureImported).toBeUndefined();
  });

  it("does not import disabled plugins, and setEnabled toggles activation", async () => {
    await writePlugin("good", GOOD_ENTRY);
    const { host, disabled } = makeHost();
    disabled.add("good");
    await host.loadAll();
    expect(host.list()[0]?.status).toBe("disabled");
    expect(activations()).toBe(0);

    await host.setEnabled("good", true);
    expect(host.list()[0]?.status).toBe("active");
    expect(activations()).toBe(1);
    expect(disabled.has("good")).toBe(false);

    await host.setEnabled("good", false);
    expect(host.list()[0]?.status).toBe("disabled");
    expect(disabled.has("good")).toBe(true);
    // registrations were disposed
    expect(host.registry.eventSubscribers).toHaveLength(0);
    expect(host.registry.trackActions).toHaveLength(0);
    expect((globalThis as Record<string, unknown>).__deactivated).toBe(true);
  });

  it("emitEvent fans out per subscriber, isolating a throwing handler", async () => {
    await writePlugin(
      "thrower",
      `export function activate(ctx) {
        ctx.events.on("trackStarted", () => { throw new Error("handler boom"); });
      }`,
    );
    await writePlugin(
      "listener",
      `export function activate(ctx) {
        globalThis.__seen = [];
        ctx.events.on("trackStarted", (p) => globalThis.__seen.push(p));
        ctx.events.on("scrobble", (p) => globalThis.__seen.push(p));
      }`,
    );
    const { host } = makeHost();
    await host.loadAll();

    const track = { title: "T", artistName: "A", durationMs: 200_000 };
    host.emitEvent("trackStarted", { track, startedAtEpochSec: 1 });
    host.emitEvent("paused", { track }); // nobody subscribed — must not throw
    host.emitEvent("scrobble", { track, startedAtEpochSec: 1 });

    // thrower's failure didn't stop listener from receiving both events
    expect((globalThis as Record<string, unknown>).__seen).toEqual([
      { track, startedAtEpochSec: 1 },
      { track, startedAtEpochSec: 1 },
    ]);
  });

  it("reloadAll re-imports fresh module instances and re-activates", async () => {
    await writePlugin("good", GOOD_ENTRY);
    const { host } = makeHost();
    await host.loadAll();
    expect(activations()).toBe(1);

    await host.reloadAll();
    expect(activations()).toBe(2); // fresh import (generation-busted URL) ran again
    expect(host.list()[0]?.status).toBe("active");
    expect(host.registry.eventSubscribers).toHaveLength(1); // old disposed, new registered
  });

  it("round-trips settings: storage for text/toggle, secrets for password", async () => {
    await writePlugin("good", GOOD_ENTRY);
    const { host } = makeHost();
    await host.loadAll();

    await host.setSetting("good", "apiKey", "abc123");
    await host.setSetting("good", "x", true);
    await host.setSetting("good", "secret", "hunter2");
    const settings = await host.getSettings("good");
    expect(settings.values).toEqual({ x: true, apiKey: "abc123", secret: { set: true } });

    await host.setSetting("good", "secret", null); // delete
    const after = await host.getSettings("good");
    expect(after.values.secret).toEqual({ set: false });

    await expect(host.setSetting("good", "nope", 1)).rejects.toThrow(/no setting/);
  });

  it("runs settings actions and surfaces handler errors as { ok: false }", async () => {
    await writePlugin("good", GOOD_ENTRY);
    const { host } = makeHost();
    await host.loadAll();

    expect(await host.runSettingsAction("good", "connect")).toEqual({
      ok: true,
      message: "connected",
    });
    expect(await host.runSettingsAction("good", "missing")).toMatchObject({ ok: false });
  });

  it("routes ctx.ui.notify to the sink with the plugin id", async () => {
    await writePlugin("noisy", `export function activate(ctx) { ctx.ui.notify("hello", "info"); }`);
    const { host, notifications } = makeHost();
    await host.loadAll();
    expect(notifications).toEqual([{ pluginId: "noisy", message: "hello", level: "info" }]);
  });

  it("getSections fans out per target, isolating throwing and slow providers", async () => {
    await writePlugin(
      "sections-a",
      `export function activate(ctx) {
        ctx.ui.contributeSections("discover", {
          id: "a",
          getSections: async (sctx) => [
            { title: "Because you listened to " + sctx.recentArtists[0], items: [{ name: "X" }] },
          ],
        });
        ctx.ui.contributeSections("home", {
          id: "a-home",
          getSections: async () => [{ title: "Home row", items: [] }],
        });
      }`,
    );
    await writePlugin(
      "sections-boom",
      `export function activate(ctx) {
        ctx.ui.contributeSections("discover", {
          id: "boom",
          getSections: async () => { throw new Error("provider boom"); },
        });
      }`,
    );
    await writePlugin(
      "sections-slow",
      `export function activate(ctx) {
        ctx.ui.contributeSections("discover", {
          id: "slow",
          getSections: () => new Promise(() => {}), // never resolves
        });
      }`,
    );
    const { host } = makeHost({ providerTimeoutMs: 50 });
    await host.loadAll();

    const sctx = { recentArtists: ["Lamb"], recentTracks: [], topArtists: [] };
    const discover = await host.getSections("discover", sctx);
    expect(discover).toEqual([
      {
        pluginId: "sections-a",
        sections: [{ title: "Because you listened to Lamb", items: [{ name: "X" }] }],
      },
    ]);
    const home = await host.getSections("home", sctx);
    expect(home).toEqual([
      { pluginId: "sections-a", sections: [{ title: "Home row", items: [] }] },
    ]);
  });

  it("lists and invokes track actions; unknown ids and failures throw with context", async () => {
    await writePlugin(
      "actions",
      `export function activate(ctx) {
        globalThis.__invoked = [];
        ctx.ui.contributeTrackAction({
          id: "love", label: "Love", icon: "heart",
          onInvoke: async (t) => { globalThis.__invoked.push(t.title); },
        });
        ctx.ui.contributeTrackAction({
          id: "explode", label: "Explode",
          onInvoke: async () => { throw new Error("action boom"); },
        });
      }`,
    );
    const { host } = makeHost();
    await host.loadAll();

    expect(host.listTrackActions()).toEqual([
      { pluginId: "actions", id: "love", label: "Love", icon: "heart" },
      { pluginId: "actions", id: "explode", label: "Explode" },
    ]);

    const track = { title: "T", artistName: "A", durationMs: 1000 };
    await host.invokeTrackAction("love", track);
    expect((globalThis as Record<string, unknown>).__invoked).toEqual(["T"]);

    await expect(host.invokeTrackAction("nope", track)).rejects.toThrow(/unknown track action/);
    // rethrown with the plugin id so the renderer knows who failed
    await expect(host.invokeTrackAction("explode", track)).rejects.toThrow(
      /\[plugin:actions\].*action boom/,
    );
  });

  it("getTrackDetails drops nulls and isolates failing providers", async () => {
    await writePlugin(
      "detail",
      `export function activate(ctx) {
        ctx.ui.contributeTrackDetail({
          id: "info",
          getDetail: async (t) => ({ title: "Info", rows: [{ label: "Title", value: t.title }] }),
        });
        ctx.ui.contributeTrackDetail({ id: "empty", getDetail: async () => null });
        ctx.ui.contributeTrackDetail({
          id: "boom",
          getDetail: async () => { throw new Error("detail boom"); },
        });
      }`,
    );
    const { host } = makeHost({ providerTimeoutMs: 50 });
    await host.loadAll();

    const details = await host.getTrackDetails({ title: "T", artistName: "A", durationMs: 1000 });
    expect(details).toEqual([
      { pluginId: "detail", title: "Info", rows: [{ label: "Title", value: "T" }] },
    ]);
  });

  it("keeps the first plugin when two directories declare the same id", async () => {
    await writePlugin("a-dupe", GOOD_ENTRY, {
      id: "dupe",
      name: "first",
      version: "1.0.0",
      apiVersion: 1,
      entry: "index.mjs",
    });
    await writePlugin("b-dupe", GOOD_ENTRY, {
      id: "dupe",
      name: "second",
      version: "1.0.0",
      apiVersion: 1,
      entry: "index.mjs",
    });
    const { host } = makeHost();
    await host.loadAll();
    expect(host.list()).toHaveLength(1);
    expect(host.list()[0]?.name).toBe("first"); // readdir order: a-dupe first
  });
});
