import type { Track } from "@musex/core";
import type { RecommendedTrack } from "@musex/plugin-api";
import { describe, expect, it } from "vitest";
import { resolveRecommendations } from "./radio-resolve";

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

describe("resolveRecommendations", () => {
  it("resolves a track-level suggestion via exact (case-insensitive) artist+title match", async () => {
    const { search, queries } = fakeSearch({
      "Lamb Gorecki": [
        track({ title: "Gorecki (Live)", artistName: "Lamb" }), // not exact — skipped
        track({ title: "GORECKI", artistName: "LAMB" }), // exact ignoring case
      ],
    });
    const out = await resolveRecommendations(
      [{ artistName: "Lamb", title: "Gorecki" }],
      [],
      5,
      search,
    );
    expect(out.map((t) => t.title)).toEqual(["GORECKI"]);
    expect(queries).toEqual(["Lamb Gorecki"]);
  });

  it("skips a track-level suggestion with no exact match in the library", async () => {
    const { search } = fakeSearch({
      "Lamb Gabriel": [track({ title: "Gabriel Remix", artistName: "Lamb" })],
    });
    const out = await resolveRecommendations(
      [{ artistName: "Lamb", title: "Gabriel" }],
      [],
      5,
      search,
    );
    expect(out).toEqual([]);
  });

  it("artist-level suggestion picks up to 2 of that artist's tracks", async () => {
    const { search, queries } = fakeSearch({
      Lamb: [
        track({ title: "Gorecki", artistName: "Lamb" }),
        track({ title: "Cotton Wool", artistName: "The Lambs" }), // wrong artist
        track({ title: "Gabriel", artistName: "lamb" }),
        track({ title: "B Line", artistName: "Lamb" }), // third match — over the per-artist cap
      ],
    });
    const out = await resolveRecommendations([{ artistName: "Lamb" }], [], 5, search);
    expect(out.map((t) => t.title)).toEqual(["Gorecki", "Gabriel"]);
    expect(queries).toEqual(["Lamb"]);
  });

  it("never picks excluded tracks (case-insensitive) and dedupes by id and key", async () => {
    const dupeId = track({ title: "Teardrop", artistName: "Massive Attack", id: "shared" });
    const { search } = fakeSearch({
      "Massive Attack": [
        track({ title: "Angel", artistName: "Massive Attack" }), // excluded
        dupeId,
        track({ title: "Inertia Creeps", artistName: "Massive Attack" }),
      ],
      "Massive Attack Teardrop": [
        { ...dupeId }, // same id as the artist-level pick — must not double up
        track({ title: "teardrop", artistName: "massive attack", id: "other" }), // same KEY
      ],
    });
    const out = await resolveRecommendations(
      [{ artistName: "Massive Attack" }, { artistName: "Massive Attack", title: "Teardrop" }],
      [{ title: "ANGEL", artist: "massive attack" }],
      5,
      search,
    );
    expect(out.map((t) => t.title)).toEqual(["Teardrop", "Inertia Creeps"]);
  });

  it("stops once count is reached and skips remaining suggestions (no extra searches)", async () => {
    const { search, queries } = fakeSearch({
      Lamb: [
        track({ title: "Gorecki", artistName: "Lamb" }),
        track({ title: "Gabriel", artistName: "Lamb" }),
      ],
      "Portishead Roads": [track({ title: "Roads", artistName: "Portishead" })],
    });
    const out = await resolveRecommendations(
      [{ artistName: "Lamb" }, { artistName: "Portishead", title: "Roads" }],
      [],
      2,
      search,
    );
    expect(out.map((t) => t.title)).toEqual(["Gorecki", "Gabriel"]);
    expect(queries).toEqual(["Lamb"]); // count hit — Portishead never searched
  });

  it("a throwing search skips that suggestion without killing the batch", async () => {
    const good = track({ title: "Roads", artistName: "Portishead" });
    const search = async (query: string): Promise<{ tracks: Track[] }> => {
      if (query === "Lamb Gorecki") throw new Error("search boom");
      return { tracks: [good] };
    };
    const recs: RecommendedTrack[] = [
      { artistName: "Lamb", title: "Gorecki" },
      { artistName: "Portishead", title: "Roads" },
    ];
    const out = await resolveRecommendations(recs, [], 5, search);
    expect(out.map((t) => t.title)).toEqual(["Roads"]);
  });
});
