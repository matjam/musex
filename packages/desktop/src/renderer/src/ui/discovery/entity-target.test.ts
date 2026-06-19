import {
  entityRefForAlbum,
  entityRefForArtist,
  entityRefForTrack,
  externalArtistRef,
} from "@musex/core";
import { describe, expect, it } from "vitest";
import { viewForEntity } from "./entity-target";

describe("viewForEntity", () => {
  it("owned artist → artist view carrying the ref", () => {
    const ref = entityRefForArtist({ id: "a1", serverId: "s1", name: "Bonobo" });
    expect(viewForEntity(ref)).toEqual({ name: "artist", ref });
  });

  it("external artist → artist view (same destination as owned)", () => {
    const ref = externalArtistRef("Bonobo");
    expect(viewForEntity(ref)).toEqual({ name: "artist", ref });
  });

  it("owned album → album view carrying the ref", () => {
    const ref = entityRefForAlbum({
      id: "al1",
      serverId: "s1",
      artistId: "a1",
      title: "Migration",
    });
    expect(viewForEntity(ref)).toEqual({ name: "album", ref });
  });

  it("owned track → artist view (no album id, never the external placeholder)", () => {
    // An owned track carries no album id, so it can't reach its OWNED album
    // page here; falling back to the artist page is safe (the old behaviour
    // sent it to an external album placeholder — the wrong, unowned page).
    const ref = entityRefForTrack({
      id: "t1",
      serverId: "s1",
      albumId: "al1",
      artistId: "a1",
      artistName: "Bonobo",
      albumTitle: "Migration",
      title: "Kerala",
      durationMs: 1000,
      media: { container: "flac", audioCodec: "flac", partId: "p", partKey: "/k" },
    });
    const v = viewForEntity(ref);
    expect(v).toEqual({ name: "artist", ref: externalArtistRef("Bonobo") });
  });
});
