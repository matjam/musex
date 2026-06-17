import type { Track } from "@musex/core";
import { describe, expect, it } from "vitest";
import type { DownloadDto } from "../../../shared/ipc-contract";
import { buildDownloadLookup, downloadKey, downloadRecordFor } from "./downloaded-records";

function rec(over: Partial<DownloadDto> & { state: DownloadDto["state"] }): DownloadDto {
  return {
    key: "k",
    serverId: "s1",
    plexPath: "/library/parts/1/file.flac",
    trackId: "t1",
    format: "original",
    bytes: 0,
    addedAt: 0,
    meta: {
      title: "Song",
      artistName: "Artist",
      durationMs: 1000,
      albumId: "alb1",
      artistId: "art1",
      container: "flac",
      audioCodec: "flac",
      partId: "p1",
    },
    ...over,
  };
}

function track(serverId: string, partKey: string): Track {
  return {
    id: "tr",
    serverId,
    albumId: "alb1",
    artistId: "art1",
    artistName: "Artist",
    title: "Song",
    durationMs: 1000,
    media: {
      container: "flac",
      audioCodec: "flac",
      partId: "p1",
      partKey,
    },
  };
}

describe("downloadKey", () => {
  it("joins serverId and plexPath with the unit separator", () => {
    expect(downloadKey("s1", "/library/parts/1/file.flac")).toBe("s1␟/library/parts/1/file.flac");
  });

  it("distinguishes same path on different servers", () => {
    expect(downloadKey("s1", "/p")).not.toBe(downloadKey("s2", "/p"));
  });
});

describe("buildDownloadLookup", () => {
  it("keys only downloaded records by server+path", () => {
    const records = [
      rec({ key: "k1", state: "downloaded", serverId: "s1", plexPath: "/a.flac" }),
      rec({ key: "k2", state: "downloaded", serverId: "s2", plexPath: "/b.flac" }),
      rec({ key: "k3", state: "downloading", serverId: "s1", plexPath: "/c.flac" }),
      rec({ key: "k4", state: "queued", serverId: "s1", plexPath: "/d.flac" }),
      rec({ key: "k5", state: "failed", serverId: "s1", plexPath: "/e.flac" }),
      rec({ key: "k6", state: "missing", serverId: "s1", plexPath: "/f.flac" }),
    ];
    const map = buildDownloadLookup(records);
    expect(map.size).toBe(2);
    expect(map.get(downloadKey("s1", "/a.flac"))?.key).toBe("k1");
    expect(map.get(downloadKey("s2", "/b.flac"))?.key).toBe("k2");
    expect(map.has(downloadKey("s1", "/c.flac"))).toBe(false);
  });

  it("returns an empty map for no records", () => {
    expect(buildDownloadLookup([]).size).toBe(0);
  });
});

describe("downloadRecordFor", () => {
  it("returns the record when the track matches a downloaded entry", () => {
    const map = buildDownloadLookup([
      rec({ key: "k1", state: "downloaded", serverId: "s1", plexPath: "/a.flac" }),
    ]);
    expect(downloadRecordFor(map, track("s1", "/a.flac"))?.key).toBe("k1");
  });

  it("returns undefined when the track isn't downloaded", () => {
    const map = buildDownloadLookup([
      rec({ key: "k1", state: "downloaded", serverId: "s1", plexPath: "/a.flac" }),
    ]);
    expect(downloadRecordFor(map, track("s1", "/other.flac"))).toBeUndefined();
    expect(downloadRecordFor(map, track("s2", "/a.flac"))).toBeUndefined();
  });
});
