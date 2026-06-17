import type { Track } from "@musex/core";
import { describe, expect, it } from "vitest";
import { buildForYouInput } from "./home-data";

function track(id: string, artistId: string, artistName: string, title: string): Track {
  return {
    id,
    serverId: "s",
    albumId: "al",
    artistId,
    artistName,
    title,
    durationMs: 200000,
    media: { container: "", audioCodec: "", partId: "p", partKey: "/p" },
  };
}

const tracks = [track("1", "ar1", "Lamb", "Gorecki"), track("2", "ar2", "Bonobo", "Kiara")];

describe("buildForYouInput", () => {
  it("resolves artist ids by name, groups tracks, and leaves similarOwned empty", () => {
    const input = buildForYouInput(
      [
        { name: "Lamb", score: 5 },
        { name: "Unknown", score: 1 },
      ],
      [
        { id: "ar1", name: "Lamb" },
        { id: "ar2", name: "Bonobo" },
      ],
      tracks,
      [{ key: "lamb␟gorecki", plays: 3, skips: 0, lastPlayedMs: 100, ratingStars: null }],
      1000,
    );
    expect(input.ownTop).toEqual([{ artistId: "ar1", name: "Lamb", score: 5 }]); // "Unknown" dropped
    expect(input.similarOwned).toEqual([]);
    expect(input.tracksByArtist.get("ar1")?.[0]?.title).toBe("Gorecki");
    expect(input.stats.get("lamb␟gorecki")?.plays).toBe(3);
    expect(input.nowMs).toBe(1000);
  });
});
