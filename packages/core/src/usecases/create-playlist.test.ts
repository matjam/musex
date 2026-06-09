import { describe, expect, it, vi } from "vitest";
import type { Library, Playlist, PlexGateway } from "../index";
import { createPlaylist } from "./create-playlist";

const library: Library = {
  id: "1",
  serverId: "s1",
  serverName: "Kraken",
  title: "Music",
  type: "music",
};
const made: Playlist = { id: "p1", serverId: "s1", title: "Road Trip", trackCount: 1 };

function gateway() {
  const createPlaylistFn = vi.fn(async () => made);
  const g = { createPlaylist: createPlaylistFn } as unknown as PlexGateway;
  return { g, createPlaylistFn };
}

describe("createPlaylist", () => {
  it("trims the title and delegates to the gateway", async () => {
    const { g, createPlaylistFn } = gateway();
    const out = await createPlaylist(g, library, "  Road Trip  ", ["t1"], "tok");
    expect(out).toEqual(made);
    expect(createPlaylistFn).toHaveBeenCalledWith(library, "Road Trip", ["t1"], "tok");
  });

  it("rejects a blank title without calling the gateway", async () => {
    const { g, createPlaylistFn } = gateway();
    await expect(createPlaylist(g, library, "   ", [], "tok")).rejects.toThrow(/title/i);
    expect(createPlaylistFn).not.toHaveBeenCalled();
  });
});
