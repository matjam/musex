import { describe, expect, it } from "vitest";
import type { AcquisitionStatusDto } from "../../../shared/ipc-contract";
import { acquisitionKey, acquisitionStateFor, buildAcquisitionMap } from "./acquisition-map";

function row(
  over: Partial<AcquisitionStatusDto> & { state: AcquisitionStatusDto["state"] },
): AcquisitionStatusDto {
  return {
    providerId: "lidarr",
    title: "Album",
    artistName: "Artist",
    ...over,
  };
}

describe("acquisitionKey", () => {
  it("trims and lowercases (matches the project-wide cross-check key)", () => {
    expect(acquisitionKey("  Boards Of Canada ")).toBe("boards of canada");
  });
});

describe("buildAcquisitionMap", () => {
  it("keys by album title for the Albums view", () => {
    const map = buildAcquisitionMap(
      [
        row({ title: "Geogaddi", state: "requested" }),
        row({ title: "Music Has the Right", state: "downloading" }),
      ],
      "title",
    );
    expect(map.get("geogaddi")).toBe("requested");
    expect(map.get("music has the right")).toBe("downloading");
  });

  it("keys by artist name for the Artists view, rolling albums up to one entry", () => {
    const map = buildAcquisitionMap(
      [
        row({ artistName: "Aphex Twin", title: "SAW II", state: "requested" }),
        row({ artistName: "Aphex Twin", title: "Drukqs", state: "downloading" }),
      ],
      "artistName",
    );
    expect(map.size).toBe(1);
    // downloading outranks requested → the artist tile shows the furthest-along.
    expect(map.get("aphex twin")).toBe("downloading");
  });

  it("collapses to the highest-ranked state regardless of row order", () => {
    const ascending = buildAcquisitionMap(
      [
        row({ artistName: "X", state: "downloaded" }),
        row({ artistName: "X", state: "downloading" }),
      ],
      "artistName",
    );
    const descending = buildAcquisitionMap(
      [
        row({ artistName: "X", state: "downloading" }),
        row({ artistName: "X", state: "downloaded" }),
      ],
      "artistName",
    );
    expect(ascending.get("x")).toBe("downloading");
    expect(descending.get("x")).toBe("downloading");
  });

  it("excludes non-acquiring states (owned/available/unavailable)", () => {
    const map = buildAcquisitionMap(
      [
        row({ title: "Owned", state: "owned" }),
        row({ title: "Available", state: "available" }),
        row({ title: "Gone", state: "unavailable" }),
        row({ title: "Wanted", state: "requested" }),
      ],
      "title",
    );
    expect(map.has("owned")).toBe(false);
    expect(map.has("available")).toBe(false);
    expect(map.has("gone")).toBe(false);
    expect(map.get("wanted")).toBe("requested");
  });

  it("normalizes keys (trim + lowercase) and ignores empty names", () => {
    const map = buildAcquisitionMap(
      [
        row({ title: "  Spaced Out  ", state: "requested" }),
        row({ title: "", state: "requested" }),
      ],
      "title",
    );
    expect(map.get("spaced out")).toBe("requested");
    expect(map.size).toBe(1);
  });

  it("returns an empty map for no rows", () => {
    expect(buildAcquisitionMap([], "title").size).toBe(0);
  });
});

describe("acquisitionStateFor", () => {
  it("looks up by normalized name", () => {
    const map = buildAcquisitionMap([row({ title: "Geogaddi", state: "requested" })], "title");
    expect(acquisitionStateFor(map, "  GEOGADDI ")).toBe("requested");
    expect(acquisitionStateFor(map, "Unknown")).toBeUndefined();
  });
});
