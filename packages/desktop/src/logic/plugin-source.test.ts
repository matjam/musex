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
        {
          id: "lidarr",
          name: "Lidarr",
          description: "x",
          apiVersion: 1,
          version: "0.1.0",
          tag: "lidarr-v0.1.0",
          asset: "lidarr-0.1.0.zip",
        },
      ],
    });
    expect(m.plugins[0]).toMatchObject({ id: "lidarr", version: "0.1.0", tag: "lidarr-v0.1.0" });
  });
  it("rejects bad schema / id / missing fields", () => {
    expect(() => parsePluginsManifest({ schemaVersion: 2, plugins: [] })).toThrow();
    expect(() =>
      parsePluginsManifest({
        schemaVersion: 1,
        plugins: [{ id: "Bad ID", name: "x", apiVersion: 1, version: "1", tag: "t", asset: "a" }],
      }),
    ).toThrow();
    expect(() =>
      parsePluginsManifest({
        schemaVersion: 1,
        plugins: [{ id: "ok", apiVersion: 1, version: "1", tag: "t", asset: "a" }],
      }),
    ).toThrow();
  });
});

describe("parseSha256File", () => {
  it("extracts the hex", () => {
    expect(
      parseSha256File(
        "e6172048c954b14d7515fb7bd82cf2cc6b0b40f81f177739bf01f6dfbea12eca  lidarr-0.1.0.zip",
      ),
    ).toBe("e6172048c954b14d7515fb7bd82cf2cc6b0b40f81f177739bf01f6dfbea12eca");
    expect(parseSha256File("nope")).toBeNull();
  });
});

describe("isSafeEntryName", () => {
  it("allows plain names, rejects traversal", () => {
    expect(isSafeEntryName("index.mjs")).toBe(true);
    expect(isSafeEntryName("plugin.json")).toBe(true);
    for (const n of ["../evil", "a/b", "a\\b", "..", "", "."])
      expect(isSafeEntryName(n)).toBe(false);
  });
});
