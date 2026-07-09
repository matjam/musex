import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ArtCache, type ArtFetch, type ArtFs, artFileName } from "./art-cache";

class FakeArtFs implements ArtFs {
  files = new Map<string, Uint8Array>();
  exists(name: string): boolean {
    return this.files.has(name);
  }
  uri(name: string): string {
    return `file:///doc/art-cache/${name}`;
  }
  write(name: string, bytes: Uint8Array): void {
    this.files.set(name, bytes);
  }
  remove(name: string): void {
    this.files.delete(name);
  }
  removeAll(): void {
    this.files.clear();
  }
}

function okFetch(bytes: Uint8Array): ArtFetch {
  return async () => ({
    ok: true,
    status: 200,
    arrayBuffer: async () =>
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  });
}

describe("artFileName", () => {
  it("maps a plain numeric album id to <id>.jpg", () => {
    expect(artFileName("12345")).toBe("12345.jpg");
  });
  it("sanitizes anything outside [A-Za-z0-9._-] (no path traversal)", () => {
    expect(artFileName("../../etc/passwd")).toBe(".._.._etc_passwd.jpg");
    expect(artFileName("a/b\\c d")).toBe("a_b_c_d.jpg");
  });
});

describe("ArtCache", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("fetchIfMissing downloads and stores the art; has/uri then report it", async () => {
    const fs = new FakeArtFs();
    const cache = new ArtCache(fs, okFetch(new Uint8Array([1, 2, 3])));
    expect(cache.has("42")).toBe(false);
    expect(cache.uri("42")).toBeNull();
    await cache.fetchIfMissing("42", "https://pms/thumb?X-Plex-Token=t");
    expect(cache.has("42")).toBe(true);
    expect(cache.uri("42")).toBe("file:///doc/art-cache/42.jpg");
    expect(fs.files.get("42.jpg")).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("fetchIfMissing skips the network when already cached", async () => {
    const fs = new FakeArtFs();
    fs.write(artFileName("42"), new Uint8Array([9]));
    const fetchFn = vi.fn<ArtFetch>();
    const cache = new ArtCache(fs, fetchFn);
    await cache.fetchIfMissing("42", "https://pms/thumb");
    expect(fetchFn).not.toHaveBeenCalled();
    expect(fs.files.get("42.jpg")).toEqual(new Uint8Array([9]));
  });

  it("logs (not throws) on a non-ok response and stores nothing", async () => {
    const fs = new FakeArtFs();
    const cache = new ArtCache(fs, async () => ({
      ok: false,
      status: 404,
      arrayBuffer: async () => new ArrayBuffer(0),
    }));
    await expect(cache.fetchIfMissing("42", "https://pms/thumb")).resolves.toBeUndefined();
    expect(cache.has("42")).toBe(false);
    expect(warnSpy).toHaveBeenCalledOnce();
  });

  it("logs (not throws) on a network failure and stores nothing", async () => {
    const fs = new FakeArtFs();
    const cache = new ArtCache(fs, async () => {
      throw new Error("offline");
    });
    await expect(cache.fetchIfMissing("42", "https://pms/thumb")).resolves.toBeUndefined();
    expect(cache.has("42")).toBe(false);
    expect(warnSpy).toHaveBeenCalledOnce();
  });

  it("remove deletes one album's art; clear deletes everything", async () => {
    const fs = new FakeArtFs();
    const cache = new ArtCache(fs, okFetch(new Uint8Array([1])));
    await cache.fetchIfMissing("1", "u");
    await cache.fetchIfMissing("2", "u");
    cache.remove("1");
    expect(cache.has("1")).toBe(false);
    expect(cache.has("2")).toBe(true);
    cache.clear();
    expect(cache.has("2")).toBe(false);
  });
});
