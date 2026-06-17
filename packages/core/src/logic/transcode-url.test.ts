import { describe, expect, it } from "vitest";
import { buildTranscodeUrl, stopSessionUrl, TRANSCODE_BITRATES } from "./transcode-url.js";

describe("buildTranscodeUrl", () => {
  it("builds the confirmed single-file MP3 URL with the forcing params", () => {
    const url = buildTranscodeUrl({
      baseUrl: "https://pms:32400",
      token: "tok",
      clientId: "cid",
      session: "sess-1",
      trackId: "8809",
      bitrateKbps: 256,
    });
    const u = new URL(url);
    expect(u.pathname).toBe("/audio/:/transcode/universal/start.mp3");
    expect(u.searchParams.get("protocol")).toBe("http");
    expect(u.searchParams.get("directPlay")).toBe("0");
    expect(u.searchParams.get("directStream")).toBe("0");
    expect(u.searchParams.get("audioCodec")).toBe("mp3");
    expect(u.searchParams.get("musicBitrate")).toBe("256");
    expect(u.searchParams.get("path")).toBe("/library/metadata/8809");
    expect(u.searchParams.get("X-Plex-Token")).toBe("tok");
    expect(u.searchParams.get("X-Plex-Client-Identifier")).toBe("cid");
    expect(u.searchParams.get("session")).toBe("sess-1");
  });

  it("stopSessionUrl targets the universal stop endpoint with the session", () => {
    const u = new URL(stopSessionUrl({ baseUrl: "https://pms:32400", token: "tok", clientId: "cid", session: "s1" }));
    expect(u.pathname).toBe("/audio/:/transcode/universal/stop");
    expect(u.searchParams.get("session")).toBe("s1");
    expect(u.searchParams.get("X-Plex-Token")).toBe("tok");
  });

  it("exposes the selectable bitrate ladder", () => {
    expect(TRANSCODE_BITRATES).toEqual([128, 192, 256, 320]);
  });
});
