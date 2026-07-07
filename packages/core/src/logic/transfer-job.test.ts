import { describe, expect, it } from "vitest";
import type { DownloadJob } from "./download-plan.js";
import { buildHlsStartUrl, stopSessionUrl, TRANSCODE_PROFILE_EXTRA } from "./transcode-url.js";
import { buildTransferJob } from "./transfer-job.js";

const job = (over: Partial<DownloadJob> = {}): DownloadJob => ({
  key: "k1",
  serverId: "s1",
  plexPath: "/library/parts/9/file.flac",
  trackId: "t9",
  meta: {
    title: "Song",
    artistName: "Artist",
    durationMs: 1000,
    albumId: "al",
    artistId: "ar",
    container: "flac",
    audioCodec: "flac",
    partId: "p1",
  },
  ...over,
});

const endpoint = { baseUrl: "http://plex:32400", token: "tok/en" };

describe("buildTransferJob — original", () => {
  it("joins the token with ? when the plexPath has no query", () => {
    const tj = buildTransferJob({
      job: job({ expectedBytes: 12345 }),
      quality: { mode: "original", bitrateKbps: 320 },
      endpoint,
      clientId: "cid",
      destPath: "/data/downloads/k1",
      session: "sess-1",
    });
    expect(tj).toEqual({
      key: "k1",
      mode: "original",
      url: `http://plex:32400/library/parts/9/file.flac?X-Plex-Token=${encodeURIComponent("tok/en")}`,
      headers: {},
      destPath: "/data/downloads/k1",
      expectedBytes: 12345,
    });
  });

  it("joins the token with & when the plexPath already has a query", () => {
    const tj = buildTransferJob({
      job: job({ plexPath: "/library/parts/9/file.flac?download=1" }),
      quality: { mode: "original", bitrateKbps: 320 },
      endpoint,
      clientId: "cid",
      destPath: "/d/k1",
      session: "s",
    });
    expect(tj.url).toBe(
      `http://plex:32400/library/parts/9/file.flac?download=1&X-Plex-Token=${encodeURIComponent("tok/en")}`,
    );
    expect(tj.expectedBytes).toBeUndefined(); // job has none
  });
});

describe("buildTransferJob — hls", () => {
  const opts = {
    job: job({ expectedBytes: 12345 }),
    quality: { mode: "aac", bitrateKbps: 192 } as const,
    endpoint,
    clientId: "cid",
    destPath: "/d/k1",
    session: "sess-hls",
  };

  it("builds the start.m3u8 URL, transcode headers and stopUrl", () => {
    const tj = buildTransferJob(opts);
    expect(tj.mode).toBe("hls");
    expect(tj.url).toBe(
      buildHlsStartUrl({
        baseUrl: endpoint.baseUrl,
        token: endpoint.token,
        clientId: "cid",
        session: "sess-hls",
        trackId: "t9",
        bitrateKbps: 192,
      }),
    );
    expect(tj.headers).toEqual({
      "X-Plex-Token": endpoint.token,
      "X-Plex-Client-Profile-Extra": TRANSCODE_PROFILE_EXTRA,
    });
    expect(tj.stopUrl).toBe(
      stopSessionUrl({
        baseUrl: endpoint.baseUrl,
        token: endpoint.token,
        clientId: "cid",
        session: "sess-hls",
      }),
    );
  });

  it("never carries expectedBytes (a transcode has no predetermined size)", () => {
    expect(buildTransferJob(opts).expectedBytes).toBeUndefined();
  });
});
