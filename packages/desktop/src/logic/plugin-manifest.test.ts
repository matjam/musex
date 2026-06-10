import { describe, expect, it } from "vitest";
import { validateManifest } from "./plugin-manifest";

const valid = {
  id: "lastfm",
  name: "Last.fm",
  version: "0.1.0",
  apiVersion: 1,
  entry: "index.mjs",
  description: "Scrobbling + discovery via Last.fm",
};

describe("validateManifest", () => {
  it("accepts a valid manifest (with and without description)", () => {
    const r = validateManifest(valid, 1);
    expect(r).toEqual({ ok: true, manifest: valid });
    const { description: _d, ...noDesc } = valid;
    const r2 = validateManifest(noDesc, 1);
    expect(r2.ok).toBe(true);
    if (r2.ok) expect(r2.manifest).toEqual(noDesc);
  });

  it("rejects non-objects", () => {
    for (const bad of [null, undefined, 42, "x", [valid]]) {
      const r = validateManifest(bad, 1);
      expect(r.ok).toBe(false);
    }
  });

  it("rejects a missing or malformed id", () => {
    for (const id of [undefined, "", "Has Spaces", "UPPER", "under_score", "dots.too", 7]) {
      const r = validateManifest({ ...valid, id }, 1);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toContain("id");
    }
  });

  it("accepts ids of lowercase letters, digits, and hyphens", () => {
    expect(validateManifest({ ...valid, id: "last-fm-2" }, 1).ok).toBe(true);
  });

  it("rejects missing or empty name/version/entry", () => {
    for (const field of ["name", "version", "entry"] as const) {
      for (const v of [undefined, "", 3]) {
        const r = validateManifest({ ...valid, [field]: v }, 1);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toContain(field);
      }
    }
  });

  it("rejects entries with path separators or traversal", () => {
    for (const entry of ["sub/index.mjs", "sub\\index.mjs", "../index.mjs", "..", "a..b.mjs"]) {
      const r = validateManifest({ ...valid, entry }, 1);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toContain("entry");
    }
  });

  it("rejects a non-numeric apiVersion", () => {
    for (const apiVersion of [undefined, "1", null]) {
      const r = validateManifest({ ...valid, apiVersion }, 1);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toContain("apiVersion");
    }
  });

  it("rejects an apiVersion mismatch with the incompatible reason", () => {
    const r = validateManifest({ ...valid, apiVersion: 2 }, 1);
    expect(r).toEqual({ ok: false, reason: "incompatible: requires API v2, host is v1" });
  });

  it("drops a non-string description rather than failing", () => {
    const r = validateManifest({ ...valid, description: 42 }, 1);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.manifest.description).toBeUndefined();
  });
});
