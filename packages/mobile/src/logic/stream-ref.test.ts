import type { Track } from "@musex/core";
import { describe, expect, it } from "vitest";
import { AVPLAYER_CODECS, decideStreamRef, isDirectPlayable } from "./stream-ref";

const track = (audioCodec: string, partKey = "/library/parts/9/file.x"): Track => ({
  id: "100",
  serverId: "srv",
  albumId: "10",
  artistId: "1",
  artistName: "A",
  title: "T",
  durationMs: 1000,
  media: { container: "x", audioCodec, partId: "9", partKey },
});

describe("isDirectPlayable", () => {
  it("accepts AVPlayer-supported codecs case-insensitively", () => {
    for (const c of AVPLAYER_CODECS) expect(isDirectPlayable(c.toUpperCase())).toBe(true);
  });
  it("rejects opus/vorbis/wavpack", () => {
    expect(isDirectPlayable("opus")).toBe(false);
    expect(isDirectPlayable("vorbis")).toBe(false);
    expect(isDirectPlayable("wavpack")).toBe(false);
  });
});

describe("decideStreamRef", () => {
  const base = "https://pms.example:32400";

  it("builds a direct URL for a supported codec", () => {
    const ref = decideStreamRef(track("flac"), base, "TOK", "CID");
    expect(ref.kind).toBe("direct");
    expect(ref.url).toBe("https://pms.example:32400/library/parts/9/file.x?X-Plex-Token=TOK");
  });

  it("builds an HLS transcode URL for an unsupported codec", () => {
    const ref = decideStreamRef(track("opus"), base, "TOK", "CID");
    expect(ref.kind).toBe("hls");
    expect(ref.url).toContain("/audio/:/transcode/universal/start.m3u8?");
    expect(ref.url).toContain(`path=${encodeURIComponent("/library/metadata/100")}`);
    expect(ref.url).toContain("protocol=hls");
    expect(ref.url).toContain("X-Plex-Token=TOK");
    expect(ref.url).toContain("X-Plex-Client-Identifier=CID");
  });
});
