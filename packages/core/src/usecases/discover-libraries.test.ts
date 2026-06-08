import { describe, expect, it, vi } from "vitest";
import type { Library, Server } from "../models/index";
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

    const libs = await discoverMusicLibraries(gateway, "tok");
    expect(libs.map((l) => l.id)).toEqual(["a1", "b1"]);
  });

  it("skips unreachable servers without failing the whole discovery", async () => {
    const gateway = new FakePlexGateway();
    gateway.servers = [server("a"), server("b")];
    gateway.libraries.set("a", [library("a1", "a")]);
    gateway.unreachableServerIds.add("b");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const libs = await discoverMusicLibraries(gateway, "tok");

    expect(libs.map((l) => l.id)).toEqual(["a1"]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
