import { describe, expect, it } from "vitest";
import type { Library, Server } from "../models/index";
import { PlexAuthError } from "../ports/plex-gateway";
import { FakePlexGateway } from "../testing/fakes";
import { discoverMusicLibraries } from "./discover-libraries";

function server(id: string): Server {
  return {
    id,
    name: `Server ${id}`,
    connections: [{ uri: `http://${id}`, local: true, relay: false }],
  };
}
function library(id: string, serverId: string): Library {
  return { id, serverId, serverName: `Server ${serverId}`, title: `Music ${id}`, type: "music" };
}

describe("discoverMusicLibraries", () => {
  it("returns music libraries from all reachable servers", async () => {
    const gateway = new FakePlexGateway();
    gateway.servers = [server("a"), server("b")];
    gateway.libraries.set("a", [library("a1", "a")]);
    gateway.libraries.set("b", [library("b1", "b")]);

    const result = await discoverMusicLibraries(gateway, "tok");
    expect(result.libraries.map((l) => l.id)).toEqual(["a1", "b1"]);
    expect(result.unreachable).toEqual([]);
  });

  it("reports unreachable servers without failing the whole discovery", async () => {
    const gateway = new FakePlexGateway();
    gateway.servers = [server("a"), server("b")];
    gateway.libraries.set("a", [library("a1", "a")]);
    gateway.unreachableServerIds.add("b");

    const result = await discoverMusicLibraries(gateway, "tok");

    expect(result.libraries.map((l) => l.id)).toEqual(["a1"]);
    expect(result.unreachable.map((s) => s.id)).toEqual(["b"]);
  });

  it("re-throws auth errors instead of marking the server unreachable", async () => {
    const gateway = new FakePlexGateway();
    gateway.servers = [server("a")];
    gateway.authErrorServerIds.add("a");

    await expect(discoverMusicLibraries(gateway, "tok")).rejects.toBeInstanceOf(PlexAuthError);
  });
});
