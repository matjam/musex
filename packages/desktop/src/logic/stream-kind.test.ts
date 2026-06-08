import { describe, expect, it } from "vitest";
import { CHROMIUM_AUDIO_CODECS, chooseStreamKind } from "./stream-kind";

describe("chooseStreamKind", () => {
  it("returns 'direct' for codecs Chromium decodes", () => {
    for (const codec of ["mp3", "aac", "flac", "opus", "vorbis"]) {
      expect(chooseStreamKind(codec)).toBe("direct");
    }
  });
  it("returns 'hls' (transcode) for codecs Chromium cannot decode", () => {
    for (const codec of ["alac", "dsd", "ape", "wavpack"]) {
      expect(chooseStreamKind(codec)).toBe("hls");
    }
  });
  it("is case-insensitive and defaults unknown codecs to transcode", () => {
    expect(chooseStreamKind("FLAC")).toBe("direct");
    expect(chooseStreamKind("something-weird")).toBe("hls");
    expect(chooseStreamKind(undefined)).toBe("hls");
  });
  it("exposes the supported set", () => {
    expect(CHROMIUM_AUDIO_CODECS.has("flac")).toBe(true);
  });
});
