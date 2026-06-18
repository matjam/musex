import { describe, expect, it } from "vitest";
import type { Album, Artist } from "../models/index.js";
import {
  entityRefForAlbum,
  entityRefForArtist,
  externalAlbumRef,
  externalArtistRef,
} from "../models/entity-ref.js";
import { followKey } from "./entity-ref.js";

const ownedArtist: Artist = { id: "a1", serverId: "srv-1", name: "Radiohead" };
const ownedAlbum: Album = {
  id: "al1",
  serverId: "srv-1",
  artistId: "a1",
  title: "OK Computer",
};

describe("entity ref constructors", () => {
  it("entityRefForArtist maps an owned artist", () => {
    const ref = entityRefForArtist(ownedArtist);
    expect(ref).toMatchObject({
      kind: "artist",
      source: "plex",
      id: "a1",
      serverId: "srv-1",
      name: "Radiohead",
    });
  });

  it("entityRefForAlbum sets name to the album title + source plex", () => {
    const ref = entityRefForAlbum(ownedAlbum);
    expect(ref).toMatchObject({
      kind: "album",
      source: "plex",
      id: "al1",
      serverId: "srv-1",
      name: "OK Computer",
      albumTitle: "OK Computer",
    });
  });

  it("externalArtistRef / externalAlbumRef build name-based external refs", () => {
    expect(externalArtistRef("Radiohead")).toMatchObject({
      kind: "artist",
      source: "external",
      name: "Radiohead",
    });
    expect(externalAlbumRef("OK Computer", "Radiohead")).toMatchObject({
      kind: "album",
      source: "external",
      name: "OK Computer",
      artistName: "Radiohead",
    });
  });
});

describe("followKey", () => {
  it("keys owned entities by kind:plex:id", () => {
    expect(followKey(entityRefForArtist(ownedArtist))).toBe("artist:plex:a1");
    expect(followKey(entityRefForAlbum(ownedAlbum))).toBe("album:plex:al1");
  });

  it("keys external entities by lowercased name (artist)", () => {
    expect(followKey(externalArtistRef("Radiohead"))).toBe("artist:external:radiohead");
  });

  it("keys external albums by artistName␟name lowercased", () => {
    expect(followKey(externalAlbumRef("OK Computer", "Radiohead"))).toBe(
      "album:external:radiohead␟ok computer",
    );
  });
});
