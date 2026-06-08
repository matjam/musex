import { describe, expect, it } from "vitest";
import { buildProxyUrl, parseProxyUrl } from "./stream-url";

describe("proxy URL round-trip", () => {
  it("builds a musex-stream URL from a serverId and a plex path (no token)", () => {
    const url = buildProxyUrl("srv-1", "/library/parts/42/file.flac");
    expect(url).toBe("musex-stream://srv-1/library/parts/42/file.flac");
  });
  it("preserves query strings (e.g. transcode params) but strips X-Plex-Token", () => {
    const url = buildProxyUrl(
      "srv-1",
      "/music/:/transcode/universal/start.m3u8?path=%2Fx&X-Plex-Token=secret&protocol=hls",
    );
    expect(url).toContain("musex-stream://srv-1/music/:/transcode/universal/start.m3u8?");
    expect(url).toContain("path=%2Fx");
    expect(url).toContain("protocol=hls");
    expect(url).not.toContain("X-Plex-Token");
  });
  it("parseProxyUrl recovers the serverId and the plex path+query", () => {
    const parsed = parseProxyUrl("musex-stream://srv-1/library/parts/42/file.flac?foo=bar");
    expect(parsed).toEqual({
      serverId: "srv-1",
      path: "/library/parts/42/file.flac",
      search: "?foo=bar",
    });
  });
  it("parseProxyUrl returns null for a non-musex-stream URL", () => {
    expect(parseProxyUrl("https://example.com/x")).toBeNull();
  });
});
