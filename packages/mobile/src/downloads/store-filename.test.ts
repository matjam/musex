import { downloadKey } from "@musex/core";
import { describe, expect, it } from "vitest";
import { keyForFileName, storeFileName } from "./store-filename";

describe("storeFileName", () => {
  const key = downloadKey("server123", "/library/parts/9/1710000000/file.flac");

  it("produces a flat filename with no path separators", () => {
    // The bug: the raw key contains '/' from the Plex part path, so expo's File
    // treats it as a nested path and every download silently fails.
    expect(key).toContain("/");
    expect(storeFileName(key)).not.toContain("/");
  });

  it("round-trips back to the original key", () => {
    expect(keyForFileName(storeFileName(key))).toBe(key);
  });

  it("preserves a distinguishable .part suffix", () => {
    const name = storeFileName(key);
    expect(name.endsWith(".part")).toBe(false);
    expect(`${name}.part`.endsWith(".part")).toBe(true);
    // The committed name decodes cleanly; the .part temp is separable.
    expect(keyForFileName(`${name}.part`.slice(0, -5))).toBe(key);
  });

  it("handles the ␟ separator and query-ish characters", () => {
    const k = downloadKey("srv", "/parts/1/file name?.m4a");
    const name = storeFileName(k);
    expect(name).not.toContain("/");
    expect(keyForFileName(name)).toBe(k);
  });
});
