import { describe, expect, it } from "vitest";
import { resolveEntityTarget } from "./entity-target";

describe("resolveEntityTarget", () => {
  it("owned artist → artist view", () => {
    expect(
      resolveEntityTarget({ kind: "artist", artistId: "a1", serverId: "s1", name: "Bonobo" }),
    ).toEqual({ name: "artist", artist: { id: "a1", serverId: "s1", name: "Bonobo" } });
  });
  it("artist without id but with provider → external-artist view", () => {
    expect(resolveEntityTarget({ kind: "artist", name: "Bonobo", hasProvider: true })).toEqual({
      name: "external-artist",
      artistName: "Bonobo",
    });
  });
  it("artist without id and no provider → null", () => {
    expect(resolveEntityTarget({ kind: "artist", name: "Bonobo" })).toBeNull();
  });
  it("owned album → album view", () => {
    const r = resolveEntityTarget({
      kind: "album",
      albumId: "al1",
      serverId: "s1",
      artistId: "a1",
      title: "Migration",
    });
    expect(r).toEqual({
      name: "album",
      album: { id: "al1", serverId: "s1", artistId: "a1", title: "Migration", thumb: undefined },
    });
  });
});
