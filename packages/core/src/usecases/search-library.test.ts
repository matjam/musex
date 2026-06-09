import { describe, expect, it, vi } from "vitest";
import type { Library, PlexGateway, SearchResults } from "../index";
import { searchLibrary } from "./search-library";

const library: Library = {
  id: "1",
  serverId: "s1",
  serverName: "Kraken",
  title: "Music",
  type: "music",
};

function gatewayReturning(results: SearchResults): {
  gateway: PlexGateway;
  search: ReturnType<typeof vi.fn>;
} {
  const search = vi.fn(async () => results);
  // Only `search` is exercised here; cast the partial as the full port.
  const gateway = { search } as unknown as PlexGateway;
  return { gateway, search };
}

const empty: SearchResults = { artists: [], albums: [], tracks: [] };

describe("searchLibrary", () => {
  it("returns empty results without calling the gateway for a blank query", async () => {
    const { gateway, search } = gatewayReturning(empty);
    expect(await searchLibrary(gateway, library, "   ", "tok")).toEqual(empty);
    expect(search).not.toHaveBeenCalled();
  });

  it("trims the query and delegates to the gateway", async () => {
    const results: SearchResults = {
      artists: [{ id: "a1", serverId: "s1", name: "Daft Punk" }],
      albums: [],
      tracks: [],
    };
    const { gateway, search } = gatewayReturning(results);
    const out = await searchLibrary(gateway, library, "  daft  ", "tok");
    expect(out).toEqual(results);
    expect(search).toHaveBeenCalledWith(library, "daft", "tok");
  });
});
