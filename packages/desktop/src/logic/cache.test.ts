import { describe, expect, it } from "vitest";
import {
  cacheKey,
  contentTypeForPath,
  isCacheablePath,
  parseByteRange,
  selectEvictions,
} from "./cache";

describe("cacheKey", () => {
  it("is deterministic for the same inputs", () => {
    expect(cacheKey("srv", "/library/parts/1/2/a.flac")).toBe(
      cacheKey("srv", "/library/parts/1/2/a.flac"),
    );
  });
  it("differs by server and by path", () => {
    const a = cacheKey("srv1", "/library/parts/1/2/a.flac");
    const b = cacheKey("srv2", "/library/parts/1/2/a.flac");
    const c = cacheKey("srv1", "/library/parts/9/9/a.flac");
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });
  it("produces a 64-char hex string (sha256)", () => {
    expect(cacheKey("s", "/p")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("isCacheablePath", () => {
  it("caches only original media files under /library/parts/", () => {
    expect(isCacheablePath("/library/parts/123/456/file.flac")).toBe(true);
  });
  it("does not cache artwork or transcode streams", () => {
    expect(isCacheablePath("/library/metadata/55/thumb/167")).toBe(false);
    expect(isCacheablePath("/music/:/transcode/universal/start.m3u8")).toBe(false);
    expect(isCacheablePath("/photo/:/transcode")).toBe(false);
  });
});

describe("contentTypeForPath", () => {
  it("maps known audio extensions", () => {
    expect(contentTypeForPath("/x/a.flac")).toBe("audio/flac");
    expect(contentTypeForPath("/x/a.MP3")).toBe("audio/mpeg");
    expect(contentTypeForPath("/x/a.m4a")).toBe("audio/mp4");
    expect(contentTypeForPath("/x/a.ogg")).toBe("audio/ogg");
    expect(contentTypeForPath("/x/a.wav")).toBe("audio/wav");
  });
  it("falls back to octet-stream for unknown/missing extensions", () => {
    expect(contentTypeForPath("/x/a.xyz")).toBe("application/octet-stream");
    expect(contentTypeForPath("/x/noext")).toBe("application/octet-stream");
  });
});

describe("parseByteRange", () => {
  it("returns null when there is no Range header", () => {
    expect(parseByteRange(undefined, 1000)).toBeNull();
  });
  it("parses a closed range", () => {
    expect(parseByteRange("bytes=100-199", 1000)).toEqual({ start: 100, end: 199 });
  });
  it("parses an open-ended range to end of file", () => {
    expect(parseByteRange("bytes=500-", 1000)).toEqual({ start: 500, end: 999 });
  });
  it("parses a suffix range (last N bytes)", () => {
    expect(parseByteRange("bytes=-100", 1000)).toEqual({ start: 900, end: 999 });
  });
  it("clamps an end past EOF", () => {
    expect(parseByteRange("bytes=900-5000", 1000)).toEqual({ start: 900, end: 999 });
  });
  it("returns null for unsatisfiable or malformed ranges", () => {
    expect(parseByteRange("bytes=2000-3000", 1000)).toBeNull();
    expect(parseByteRange("bytes=abc", 1000)).toBeNull();
    expect(parseByteRange("bytes=-", 1000)).toBeNull();
    expect(parseByteRange("bytes=500-100", 1000)).toBeNull();
  });
});

describe("selectEvictions", () => {
  const e = (name: string, size: number, mtimeMs: number) => ({ name, size, mtimeMs });
  it("returns nothing when under the cap", () => {
    expect(selectEvictions([e("a", 100, 1), e("b", 100, 2)], 1000)).toEqual([]);
  });
  it("evicts oldest-first until within the cap", () => {
    const entries = [e("new", 400, 30), e("old", 400, 10), e("mid", 400, 20)];
    expect(selectEvictions(entries, 1000)).toEqual(["old"]);
  });
  it("evicts multiple when needed", () => {
    const entries = [e("a", 500, 1), e("b", 500, 2), e("c", 500, 3)];
    expect(selectEvictions(entries, 600)).toEqual(["a", "b"]);
  });
});
