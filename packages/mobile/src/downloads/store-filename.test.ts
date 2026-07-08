import { downloadKey } from "@musex/core";
import { describe, expect, it } from "vitest";
import {
  CONVERTED_SUFFIX,
  convertedFileName,
  isConvertedFileName,
  keyForDiskName,
  keyForFileName,
  storeFileName,
} from "./store-filename";

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

describe("converted artifact naming (.conv.m4a)", () => {
  const key = downloadKey("server123", "/library/parts/9/1710000000/file.flac");

  it("converted name ends in .m4a (AVPlayer extension sniffing) with no path separators", () => {
    const name = convertedFileName(key);
    expect(name).not.toContain("/");
    expect(name.endsWith(".m4a")).toBe(true);
    expect(name.endsWith(CONVERTED_SUFFIX)).toBe(true);
    // Suffix appended to the bare flat name, nothing else changed.
    expect(name).toBe(storeFileName(key) + CONVERTED_SUFFIX);
  });

  it("round-trips back to the original key via keyForDiskName", () => {
    expect(keyForDiskName(convertedFileName(key))).toBe(key);
  });

  it("bare names pass through keyForDiskName unchanged", () => {
    expect(keyForDiskName(storeFileName(key))).toBe(key);
  });

  it("is unambiguous vs an original whose OWN flat name ends .m4a", () => {
    const m4aKey = downloadKey("srv", "/library/parts/9/1/song.m4a");
    const bare = storeFileName(m4aKey);
    expect(bare.endsWith(".m4a")).toBe(true);
    expect(isConvertedFileName(bare)).toBe(false);
    expect(isConvertedFileName(convertedFileName(m4aKey))).toBe(true);
    // Both decode back to the same key.
    expect(keyForDiskName(bare)).toBe(m4aKey);
    expect(keyForDiskName(convertedFileName(m4aKey))).toBe(m4aKey);
  });
});
