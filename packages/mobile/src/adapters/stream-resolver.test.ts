import type { Track } from "@musex/core";
import { describe, expect, it } from "vitest";
import { PlexStreamResolver } from "./stream-resolver";

function makeTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: "t1",
    serverId: "s1",
    albumId: "al1",
    artistId: "ar1",
    title: "Test Track",
    artistName: "Artist",
    albumTitle: "Album",
    durationMs: 1000,
    trackNumber: 1,
    media: {
      container: "flac",
      audioCodec: "flac",
      partId: "p1",
      partKey: "/library/parts/1/file.flac",
    },
    ...overrides,
  };
}

describe("PlexStreamResolver", () => {
  it("returns a local file URI when localUriFor returns non-null", async () => {
    const localUri = "file:///downloads/abc123";
    const resolver = new PlexStreamResolver(
      () => "https://pms.example.com",
      () => "token",
      "clientId",
      () => localUri,
    );
    const ref = await resolver.resolve(makeTrack());
    expect(ref.kind).toBe("direct");
    expect(ref.url).toBe(localUri);
  });

  it("falls through to decideStreamRef when localUriFor returns null", async () => {
    const resolver = new PlexStreamResolver(
      () => "https://pms.example.com",
      () => "mytoken",
      "clientId",
      () => null,
    );
    const track = makeTrack({
      media: {
        container: "flac",
        audioCodec: "flac",
        partId: "p1",
        partKey: "/library/parts/1/file.flac",
      },
    });
    const ref = await resolver.resolve(track);
    // flac is direct-playable on iOS (AVPlayer supports it)
    expect(ref.kind).toBe("direct");
    expect(ref.url).toContain("pms.example.com");
    expect(ref.url).toContain("mytoken");
  });

  it("falls through to decideStreamRef when no localUriFor is provided", async () => {
    const resolver = new PlexStreamResolver(
      () => "https://pms.example.com",
      () => "mytoken",
      "clientId",
    );
    const track = makeTrack({
      media: {
        container: "flac",
        audioCodec: "flac",
        partId: "p1",
        partKey: "/library/parts/1/file.flac",
      },
    });
    const ref = await resolver.resolve(track);
    expect(ref.kind).toBe("direct");
    expect(ref.url).toContain("pms.example.com");
  });

  it("falls through to hls transcode for a non-AVPlayer codec when localUriFor returns null", async () => {
    const resolver = new PlexStreamResolver(
      () => "https://pms.example.com",
      () => "mytoken",
      "clientId",
      () => null,
    );
    const track = makeTrack({
      media: {
        container: "opus",
        audioCodec: "opus",
        partId: "p1",
        partKey: "/library/parts/2/file.opus",
      },
    });
    const ref = await resolver.resolve(track);
    // opus is not direct-playable on iOS → HLS transcode
    expect(ref.kind).toBe("hls");
    expect(ref.url).toContain("transcode");
  });
});
