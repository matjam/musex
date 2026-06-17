import type { Track } from "@musex/core";
import { smartTrackKey } from "@musex/core";
import { describe, expect, it } from "vitest";
import { recentlyPlayedTracks } from "./recently-played.js";

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

describe("recentlyPlayedTracks", () => {
  it("returns library tracks most-recently-played first, joined by key", () => {
    const stats = [
      // biome-ignore lint/style/noNonNullAssertion: test array always has 2 elements
      { key: smartTrackKey(tracks[0]!), lastPlayedMs: 100 }, // Lamb / Gorecki
      // biome-ignore lint/style/noNonNullAssertion: test array always has 2 elements
      { key: smartTrackKey(tracks[1]!), lastPlayedMs: 200 }, // Bonobo / Kiara
    ];
    const got = recentlyPlayedTracks(stats, tracks, 10);
    expect(got.map((t) => t.title)).toEqual(["Kiara", "Gorecki"]);
  });

  it("drops stats with no matching library track and honors the limit", () => {
    const stats = [
      // biome-ignore lint/style/noNonNullAssertion: test array always has 2 elements
      { key: smartTrackKey(tracks[1]!), lastPlayedMs: 200 }, // Bonobo / Kiara
      { key: "ghost␟missing", lastPlayedMs: 300 }, // no matching library track
    ];
    expect(recentlyPlayedTracks(stats, tracks, 1).map((t) => t.title)).toEqual(["Kiara"]);
  });
});
