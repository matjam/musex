import { describe, expect, it } from "vitest";
import { mergeDiscography } from "./discography-merge";

const lidarr = (title: string, state: string) => ({
  providerId: "lidarr",
  providerRef: `ref-${title}`,
  artistName: "Artist",
  title,
  state: state as never,
});

describe("mergeDiscography", () => {
  it("acquirable albums pass through; lastfm-only titles append as unavailable", () => {
    const merged = mergeDiscography(
      "Artist",
      [lidarr("Alpha", "available"), lidarr("Beta", "owned")],
      [{ title: "Alpha" }, { title: "Gamma" }],
    );
    expect(merged).toHaveLength(3);
    expect(merged[2]).toMatchObject({
      title: "Gamma",
      state: "unavailable",
      providerId: "external",
      providerRef: "title:gamma",
    });
  });

  it("title match is case-insensitive (no duplicate for 'ALPHA')", () => {
    const merged = mergeDiscography("Artist", [lidarr("Alpha", "available")], [{ title: "ALPHA" }]);
    expect(merged).toHaveLength(1);
  });

  it("no acquisition results at all: every known title is unavailable", () => {
    const merged = mergeDiscography("Artist", [], [{ title: "One" }, { title: "one" }]);
    expect(merged).toHaveLength(1); // deduped case-insensitively
    expect(merged[0]?.state).toBe("unavailable");
  });
});
