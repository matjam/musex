import { describe, expect, it, vi } from "vitest";

vi.mock("@react-native-async-storage/async-storage", () => {
  const m = new Map<string, string>();
  return {
    default: {
      getItem: async (k: string) => m.get(k) ?? null,
      setItem: async (k: string, v: string) => void m.set(k, v),
    },
  };
});

import type { PluginManifest } from "@musex/plugin-api";
import { type InstalledPlugin, PluginIndex } from "./plugin-index";

const manifest = (id: string): PluginManifest => ({
  id,
  name: id,
  version: "0.1.0",
  apiVersion: 2,
  entry: "index.mjs",
});

const installed = (id: string, enabled = true): InstalledPlugin => ({
  id,
  manifest: manifest(id),
  enabled,
  source: { owner: "matjam", repo: "musex-plugins", version: "0.1.0" },
});

describe("PluginIndex", () => {
  it("upsert/all/get round-trips and persists across instances", async () => {
    const idx = new PluginIndex();
    await idx.load();
    await idx.upsert(installed("lidarr"));
    expect(idx.get("lidarr")?.manifest.name).toBe("lidarr");
    expect(idx.all()).toHaveLength(1);

    const idx2 = new PluginIndex();
    await idx2.load();
    expect(idx2.get("lidarr")?.source.repo).toBe("musex-plugins");
  });

  it("setEnabled persists and isEnabled reflects it", async () => {
    const idx = new PluginIndex();
    await idx.load();
    await idx.upsert(installed("lidarr", true));
    expect(idx.isEnabled("lidarr")).toBe(true);
    await idx.setEnabled("lidarr", false);
    expect(idx.isEnabled("lidarr")).toBe(false);

    const idx2 = new PluginIndex();
    await idx2.load();
    expect(idx2.isEnabled("lidarr")).toBe(false);
  });

  it("remove drops the record", async () => {
    const idx = new PluginIndex();
    await idx.load();
    await idx.upsert(installed("lidarr"));
    await idx.remove("lidarr");
    expect(idx.get("lidarr")).toBeUndefined();
    expect(idx.isEnabled("lidarr")).toBe(false);
  });
});
