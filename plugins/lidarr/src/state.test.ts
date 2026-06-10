import { describe, expect, it } from "vitest";
import { deriveAlbumState } from "./state.js";

describe("deriveAlbumState", () => {
  it("downloaded when all tracks have files", () => {
    expect(
      deriveAlbumState(
        { monitored: true, statistics: { trackFileCount: 12, totalTrackCount: 12 } },
        false,
      ),
    ).toEqual({ state: "downloaded", detail: "12/12 tracks" });
  });

  it("downloaded wins over in-queue (post-import overlap)", () => {
    expect(
      deriveAlbumState(
        { monitored: true, statistics: { trackFileCount: 10, totalTrackCount: 10 } },
        true,
      ),
    ).toEqual({ state: "downloaded", detail: "10/10 tracks" });
  });

  it("not downloaded when trackFileCount is 0 even if totalTrackCount is 0", () => {
    expect(
      deriveAlbumState(
        { monitored: false, statistics: { trackFileCount: 0, totalTrackCount: 0 } },
        false,
      ),
    ).toEqual({ state: "available" });
  });

  it("downloading when in queue and not complete", () => {
    expect(
      deriveAlbumState(
        { monitored: true, statistics: { trackFileCount: 0, totalTrackCount: 11 } },
        true,
      ),
    ).toEqual({ state: "downloading" });
  });

  it("downloading even when unmonitored (manual grab still in queue)", () => {
    expect(deriveAlbumState({ monitored: false }, true)).toEqual({ state: "downloading" });
  });

  it("requested when monitored with no files", () => {
    expect(
      deriveAlbumState(
        { monitored: true, statistics: { trackFileCount: 0, totalTrackCount: 9 } },
        false,
      ),
    ).toEqual({ state: "requested" });
  });

  it("requested with partial-files detail", () => {
    expect(
      deriveAlbumState(
        { monitored: true, statistics: { trackFileCount: 7, totalTrackCount: 12 } },
        false,
      ),
    ).toEqual({ state: "requested", detail: "7/12 tracks" });
  });

  it("requested when monitored and statistics are missing", () => {
    expect(deriveAlbumState({ monitored: true }, false)).toEqual({ state: "requested" });
  });

  it("available when unmonitored and incomplete", () => {
    expect(
      deriveAlbumState(
        { monitored: false, statistics: { trackFileCount: 0, totalTrackCount: 10 } },
        false,
      ),
    ).toEqual({ state: "available" });
  });

  it("available when unmonitored with no statistics", () => {
    expect(deriveAlbumState({ monitored: false }, false)).toEqual({ state: "available" });
  });
});
