import { describe, expect, it } from "vitest";
import type { DownloadRecord, Track } from "../index.js";
import {
  buildDownloadLookup,
  downloadedContainerIds,
  downloadingContainerIds,
  downloadKey,
  downloadRecordFor,
} from "./download-lookup.js";

const rec = (over: Partial<DownloadRecord>): DownloadRecord => ({
  key: "k",
  serverId: "s1",
  plexPath: "/library/parts/1/f.flac",
  trackId: "t1",
  format: "original",
  state: "downloaded",
  bytes: 10,
  addedAt: 0,
  meta: {
    title: "T",
    artistName: "A",
    durationMs: 1,
    albumId: "al1",
    artistId: "ar1",
    container: "flac",
    audioCodec: "flac",
    partId: "1",
  },
  ...over,
});

describe("downloadKey", () => {
  it("joins serverId + plexPath with the unit separator", () => {
    expect(downloadKey("s1", "/p")).toBe("s1␟/p");
  });
});

describe("buildDownloadLookup / downloadRecordFor", () => {
  it("includes only downloaded records, keyed by serverId+plexPath", () => {
    const lookup = buildDownloadLookup([rec({}), rec({ state: "queued", plexPath: "/q" })]);
    expect(lookup.size).toBe(1);
    const track = { serverId: "s1", media: { partKey: "/library/parts/1/f.flac" } } as Track;
    expect(downloadRecordFor(lookup, track)?.trackId).toBe("t1");
  });
});

describe("container id sets", () => {
  it("downloadedContainerIds collects albumId/artistId of downloaded records", () => {
    expect(downloadedContainerIds([rec({})], "albumId").has("al1")).toBe(true);
    expect(downloadedContainerIds([rec({ state: "queued" })], "albumId").size).toBe(0);
  });
  it("downloadingContainerIds collects queued + downloading", () => {
    expect(downloadingContainerIds([rec({ state: "downloading" })], "artistId").has("ar1")).toBe(
      true,
    );
    expect(downloadingContainerIds([rec({ state: "downloaded" })], "artistId").size).toBe(0);
  });
});
