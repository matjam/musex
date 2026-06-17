import { describe, expect, it } from "vitest";
import {
  buildHlsStartUrl,
  parseHlsMaster,
  parseHlsMedia,
  stopSessionUrl,
  TRANSCODE_BITRATES,
  TRANSCODE_PROFILE_EXTRA,
} from "./transcode-url.js";

describe("TRANSCODE_BITRATES", () => {
  it("exposes the selectable bitrate ladder", () => {
    expect(TRANSCODE_BITRATES).toEqual([128, 192, 256, 320]);
  });
});

describe("TRANSCODE_PROFILE_EXTRA", () => {
  it("contains container=mpegts", () => {
    expect(TRANSCODE_PROFILE_EXTRA).toContain("container=mpegts");
  });
  it("contains audioCodec=aac", () => {
    expect(TRANSCODE_PROFILE_EXTRA).toContain("audioCodec=aac");
  });
});

describe("buildHlsStartUrl", () => {
  it("builds the HLS start.m3u8 URL with the required params", () => {
    const url = buildHlsStartUrl({
      baseUrl: "https://pms:32400",
      token: "tok",
      clientId: "cid",
      session: "sess-1",
      trackId: "8809",
      bitrateKbps: 256,
    });
    const u = new URL(url);
    expect(u.pathname).toBe("/music/:/transcode/universal/start.m3u8");
    expect(u.searchParams.get("protocol")).toBe("hls");
    expect(u.searchParams.get("audioCodec")).toBe("aac");
    expect(u.searchParams.get("musicBitrate")).toBe("256");
    expect(u.searchParams.get("directPlay")).toBe("0");
    expect(u.searchParams.get("directStream")).toBe("0");
    expect(u.searchParams.get("path")).toBe("/library/metadata/8809");
    expect(u.searchParams.get("session")).toBe("sess-1");
    expect(u.searchParams.get("X-Plex-Session-Identifier")).toBe("sess-1");
    expect(u.searchParams.get("X-Plex-Client-Identifier")).toBe("cid");
    expect(u.searchParams.get("X-Plex-Token")).toBe("tok");
  });
});

describe("parseHlsMaster", () => {
  it("returns the first variant URI from a master playlist", () => {
    const master = [
      "#EXTM3U",
      "#EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=243000",
      "session/abc123/base/index.m3u8",
    ].join("\n");
    expect(parseHlsMaster(master)).toBe("session/abc123/base/index.m3u8");
  });

  it("returns null for a media playlist (no STREAM-INF)", () => {
    const media = [
      "#EXTM3U",
      "#EXT-X-TARGETDURATION:10",
      "#EXTINF:1.0,",
      "seg000.ts",
      "#EXT-X-ENDLIST",
    ].join("\n");
    expect(parseHlsMaster(media)).toBeNull();
  });

  it("skips blank lines between STREAM-INF and the URI", () => {
    const master = [
      "#EXTM3U",
      "#EXT-X-STREAM-INF:BANDWIDTH=128000",
      "",
      "session/xyz/base/index.m3u8",
    ].join("\n");
    expect(parseHlsMaster(master)).toBe("session/xyz/base/index.m3u8");
  });
});

describe("parseHlsMedia", () => {
  const SAMPLE_MEDIA_ENDED = [
    "#EXTM3U",
    "#EXT-X-TARGETDURATION:2",
    "#EXTINF:1.0,",
    "seg000.ts",
    "#EXTINF:1.5,",
    "seg001.ts",
    "#EXTINF:0.8,",
    "seg002.ts",
    "#EXT-X-ENDLIST",
  ].join("\n");

  const SAMPLE_MEDIA_LIVE = [
    "#EXTM3U",
    "#EXT-X-TARGETDURATION:2",
    "#EXTINF:1.0,",
    "seg000.ts",
    "#EXTINF:1.5,",
    "seg001.ts",
  ].join("\n");

  it("parses three segments with correct uris and durations, ended=true", () => {
    const result = parseHlsMedia(SAMPLE_MEDIA_ENDED);
    expect(result.ended).toBe(true);
    expect(result.segments).toHaveLength(3);
    expect(result.segments[0]).toEqual({ uri: "seg000.ts", durationSec: 1.0 });
    expect(result.segments[1]).toEqual({ uri: "seg001.ts", durationSec: 1.5 });
    expect(result.segments[2]).toEqual({ uri: "seg002.ts", durationSec: 0.8 });
  });

  it("returns ended=false when #EXT-X-ENDLIST is absent", () => {
    const result = parseHlsMedia(SAMPLE_MEDIA_LIVE);
    expect(result.ended).toBe(false);
    expect(result.segments).toHaveLength(2);
  });
});

describe("stopSessionUrl", () => {
  it("targets the universal stop endpoint with the session", () => {
    const u = new URL(
      stopSessionUrl({
        baseUrl: "https://pms:32400",
        token: "tok",
        clientId: "cid",
        session: "s1",
      }),
    );
    expect(u.pathname).toBe("/audio/:/transcode/universal/stop");
    expect(u.searchParams.get("session")).toBe("s1");
    expect(u.searchParams.get("X-Plex-Token")).toBe("tok");
  });
});
