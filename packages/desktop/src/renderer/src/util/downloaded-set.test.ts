import { describe, expect, it } from "vitest";
import type { DownloadDto } from "../../../shared/ipc-contract";
import { downloadedContainerIds, downloadingContainerIds } from "./downloaded-set";

function rec(over: Partial<DownloadDto> & { state: DownloadDto["state"] }): DownloadDto {
  return {
    key: "k",
    serverId: "s",
    plexPath: "/library/parts/1/file.flac",
    trackId: "t",
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

describe("downloadedContainerIds", () => {
  it("collects albumIds only from downloaded records", () => {
    const records = [
      rec({ state: "downloaded", meta: makeMeta("alb1", "art1") }),
      rec({ state: "downloaded", meta: makeMeta("alb2", "art1") }),
      rec({ state: "downloading", meta: makeMeta("alb3", "art2") }),
      rec({ state: "queued", meta: makeMeta("alb4", "art2") }),
      rec({ state: "failed", meta: makeMeta("alb5", "art3") }),
      rec({ state: "missing", meta: makeMeta("alb6", "art3") }),
    ];
    expect([...downloadedContainerIds(records, "albumId")].sort()).toEqual(["alb1", "alb2"]);
  });

  it("collects artistIds only from downloaded records", () => {
    const records = [
      rec({ state: "downloaded", meta: makeMeta("alb1", "art1") }),
      rec({ state: "downloaded", meta: makeMeta("alb2", "art1") }),
      rec({ state: "downloaded", meta: makeMeta("alb3", "art2") }),
      rec({ state: "downloading", meta: makeMeta("alb4", "art3") }),
    ];
    expect([...downloadedContainerIds(records, "artistId")].sort()).toEqual(["art1", "art2"]);
  });

  it("returns an empty set for no downloaded records", () => {
    expect(downloadedContainerIds([], "albumId").size).toBe(0);
    expect(downloadedContainerIds([rec({ state: "downloading" })], "albumId").size).toBe(0);
  });

  it("ignores empty container ids", () => {
    const records = [rec({ state: "downloaded", meta: makeMeta("", "") })];
    expect(downloadedContainerIds(records, "albumId").size).toBe(0);
    expect(downloadedContainerIds(records, "artistId").size).toBe(0);
  });
});

describe("downloadingContainerIds", () => {
  it("collects albumIds only from in-flight (downloading/queued) records", () => {
    const records = [
      rec({ state: "downloading", meta: makeMeta("alb1", "art1") }),
      rec({ state: "queued", meta: makeMeta("alb2", "art1") }),
      rec({ state: "downloaded", meta: makeMeta("alb3", "art2") }),
      rec({ state: "failed", meta: makeMeta("alb4", "art2") }),
      rec({ state: "missing", meta: makeMeta("alb5", "art3") }),
    ];
    expect([...downloadingContainerIds(records, "albumId")].sort()).toEqual(["alb1", "alb2"]);
  });

  it("collects artistIds only from in-flight records", () => {
    const records = [
      rec({ state: "downloading", meta: makeMeta("alb1", "art1") }),
      rec({ state: "queued", meta: makeMeta("alb2", "art1") }),
      rec({ state: "queued", meta: makeMeta("alb3", "art2") }),
      rec({ state: "downloaded", meta: makeMeta("alb4", "art3") }),
    ];
    expect([...downloadingContainerIds(records, "artistId")].sort()).toEqual(["art1", "art2"]);
  });

  it("returns an empty set when nothing is in flight", () => {
    expect(downloadingContainerIds([], "albumId").size).toBe(0);
    expect(downloadingContainerIds([rec({ state: "downloaded" })], "albumId").size).toBe(0);
  });

  it("ignores empty container ids", () => {
    const records = [rec({ state: "downloading", meta: makeMeta("", "") })];
    expect(downloadingContainerIds(records, "albumId").size).toBe(0);
    expect(downloadingContainerIds(records, "artistId").size).toBe(0);
  });
});

function makeMeta(albumId: string, artistId: string): DownloadDto["meta"] {
  return {
    title: "Song",
    artistName: "Artist",
    durationMs: 1000,
    albumId,
    artistId,
    container: "flac",
    audioCodec: "flac",
    partId: "p1",
  };
}
