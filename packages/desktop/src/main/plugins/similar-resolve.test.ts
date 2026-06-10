import type { Track } from "@musex/core";
import { describe, expect, it } from "vitest";
import { resolveSimilarTracks } from "./similar-resolve";

function track(over: Partial<Track> & { title: string; artistName: string }): Track {
  return {
    id: `${over.artistName}/${over.title}`,
    serverId: "srv",
    albumId: "alb",
    artistId: "art",
    durationMs: 200_000,
    media: { container: "flac", audioCodec: "flac", partId: "p1", partKey: "/k" },
    ...over,
  };
}

/** Fake gateway.search wrapper: results keyed by the exact query string. */
function fakeSearch(byQuery: Record<string, Track[]>) {
  const queries: string[] = [];
  const search = async (query: string): Promise<{ tracks: Track[] }> => {
    queries.push(query);
    return { tracks: byQuery[query] ?? [] };
  };
  return { search, queries };
}

describe("resolveSimilarTracks", () => {
  it("attaches the owned track on an exact (case-insensitive) artist+title match", async () => {
    const owned = track({ title: "GORECKI", artistName: "LAMB" });
    const { search, queries } = fakeSearch({
      "Lamb Gorecki": [
        track({ title: "Gorecki (Live)", artistName: "Lamb" }), // not exact — skipped
        owned,
      ],
    });
    const out = await resolveSimilarTracks(
      [{ name: "Gorecki", artistName: "Lamb", externalUrl: "https://last.fm/g" }],
      search,
    );
    expect(out).toEqual([
      { name: "Gorecki", artistName: "Lamb", externalUrl: "https://last.fm/g", track: owned },
    ]);
    expect(queries).toEqual(["Lamb Gorecki"]);
  });

  it("flags unmatched, artist-less, and failing-search items as external", async () => {
    const search = async (query: string): Promise<{ tracks: Track[] }> => {
      if (query === "Lamb Gabriel") throw new Error("plex down");
      return { tracks: [track({ title: "Glory Box Remix", artistName: "Portishead" })] };
    };
    const out = await resolveSimilarTracks(
      [
        { name: "Glory Box", artistName: "Portishead" }, // no exact match
        { name: "Mystery Song" }, // no artistName
        { name: "Gabriel", artistName: "Lamb" }, // search throws
      ],
      search,
    );
    expect(out).toEqual([
      { name: "Glory Box", artistName: "Portishead", external: true },
      { name: "Mystery Song", external: true },
      { name: "Gabriel", artistName: "Lamb", external: true },
    ]);
  });
});
