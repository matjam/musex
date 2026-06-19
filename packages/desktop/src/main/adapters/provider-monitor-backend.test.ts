import { describe, expect, it } from "vitest";
import { type AcquisitionFacade, ProviderMonitorBackend } from "./provider-monitor-backend.js";

function fakeProvider(over: Partial<AcquisitionFacade> = {}) {
  const calls = {
    acquireArtistByName: [] as string[],
    watchNewReleases: [] as { name: string; enabled: boolean }[],
  };
  const provider: AcquisitionFacade = {
    acquireArtistByName: async (name) => {
      calls.acquireArtistByName.push(name);
    },
    watchNewReleases: async (name, enabled) => {
      calls.watchNewReleases.push({ name, enabled });
    },
    listMonitoredArtists: async () => [],
    listWatchedArtists: async () => [],
    ...over,
  };
  return { provider, calls };
}

describe("ProviderMonitorBackend", () => {
  it("follow → acquireArtistByName", async () => {
    const { provider, calls } = fakeProvider();
    const backend = new ProviderMonitorBackend(() => provider);
    await backend.follow("Radiohead");
    expect(calls.acquireArtistByName).toEqual(["Radiohead"]);
  });

  it("unfollow → watchNewReleases(name, false) (acquired media kept)", async () => {
    const { provider, calls } = fakeProvider();
    const backend = new ProviderMonitorBackend(() => provider);
    await backend.unfollow("Radiohead");
    expect(calls.watchNewReleases).toEqual([{ name: "Radiohead", enabled: false }]);
  });

  it("isFollowed reads the monitored ∪ watched union (case-insensitive)", async () => {
    const { provider } = fakeProvider({
      listMonitoredArtists: async () => ["Radiohead"],
      listWatchedArtists: async () => ["Aphex Twin"],
    });
    const backend = new ProviderMonitorBackend(() => provider);
    expect(await backend.isFollowed("radiohead")).toBe(true);
    expect(await backend.isFollowed("APHEX TWIN")).toBe(true);
    expect(await backend.isFollowed("Boards of Canada")).toBe(false);
  });

  it("listFollowed returns the deduped union", async () => {
    const { provider } = fakeProvider({
      listMonitoredArtists: async () => ["Radiohead", "Aphex Twin"],
      listWatchedArtists: async () => ["radiohead", "Boards of Canada"],
    });
    const backend = new ProviderMonitorBackend(() => provider);
    const list = await backend.listFollowed();
    expect(list).toHaveLength(3);
    expect(list).toContain("Radiohead");
    expect(list).toContain("Aphex Twin");
    expect(list).toContain("Boards of Canada");
    // The duplicate "radiohead" is folded into the first-seen "Radiohead".
    expect(list.filter((n) => n.toLowerCase() === "radiohead")).toEqual(["Radiohead"]);
  });

  it("no provider: follow / unfollow throw, isFollowed → false, listFollowed → []", async () => {
    const backend = new ProviderMonitorBackend(() => null);
    await expect(backend.follow("x")).rejects.toThrow("no acquisition plugin installed");
    await expect(backend.unfollow("x")).rejects.toThrow("no acquisition plugin installed");
    expect(await backend.isFollowed("x")).toBe(false);
    expect(await backend.listFollowed()).toEqual([]);
  });
});
