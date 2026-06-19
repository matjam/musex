import type { Album } from "@musex/core";
import { describe, expect, it } from "vitest";
import type { AcquirableAlbumDto } from "../../../../shared/ipc-contract";
import { unifyDiscography } from "./artist-discography";

const ownedAlbum = (id: string, title: string, year?: number): Album => ({
  id,
  serverId: "s1",
  artistId: "ar1",
  title,
  year,
});

const ext = (
  title: string,
  state: AcquirableAlbumDto["state"],
  extra: Partial<AcquirableAlbumDto> = {},
): AcquirableAlbumDto => ({
  title,
  artistName: "Radiohead",
  providerRef: `ref:${title}`,
  providerId: "lidarr",
  state,
  ...extra,
});

describe("unifyDiscography", () => {
  it("lists owned albums first as in-library navigable refs", () => {
    const items = unifyDiscography([ownedAlbum("al1", "OK Computer", 1997)], []);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      title: "OK Computer",
      ref: { kind: "album", source: "plex", id: "al1" },
      downloaded: false,
      acquiring: false,
      unavailable: false,
    });
  });

  it("appends external-only titles after owned, with acquisition status", () => {
    const items = unifyDiscography(
      [ownedAlbum("al1", "OK Computer")],
      [ext("Kid A", "available"), ext("Amnesiac", "downloading")],
    );
    expect(items.map((i) => i.title)).toEqual(["OK Computer", "Kid A", "Amnesiac"]);
    const kidA = items[1];
    expect(kidA?.ref).toMatchObject({ kind: "album", source: "external", name: "Kid A" });
    expect(kidA?.acquire).toEqual({ providerId: "lidarr", providerRef: "ref:Kid A" });
    expect(items[2]?.acquiring).toBe(true);
    expect(items[2]?.acquire).toBeUndefined();
  });

  it("drops an external title that clashes (case-insensitively) with an owned one", () => {
    const items = unifyDiscography(
      [ownedAlbum("al1", "OK Computer")],
      [ext("ok computer", "available")],
    );
    expect(items).toHaveLength(1);
    expect(items[0]?.ref.source).toBe("plex");
  });

  it("surfaces a provider-owned album (no local owned list) as a navigable plex ref", () => {
    const items = unifyDiscography(
      [],
      [ext("In Rainbows", "owned", { albumId: "al9", serverId: "s1", artistId: "ar1" })],
    );
    expect(items[0]?.ref).toMatchObject({ kind: "album", source: "plex", id: "al9" });
  });

  it("marks unavailable (last.fm-only) titles and leaves no acquire path", () => {
    const items = unifyDiscography([], [ext("Bootleg", "unavailable")]);
    expect(items[0]).toMatchObject({ unavailable: true, acquiring: false });
    expect(items[0]?.acquire).toBeUndefined();
  });
});
