import { describe, expect, it } from "vitest";
import { entityRefForAlbum, externalArtistRef } from "../models/entity-ref.js";
import type { Album } from "../models/index.js";
import { FakeFollowStore, FakeMonitorBackend } from "../testing/fakes.js";
import { followKey } from "./entity-ref.js";
import { FollowService } from "./follow-service.js";

const NOW = 1_000;
const now = () => NOW;
const ownedAlbum: Album = { id: "al1", serverId: "srv-1", artistId: "a1", title: "OK Computer" };

describe("FollowService", () => {
  it("follow(artist) with monitor → backend.follow + local record", async () => {
    const store = new FakeFollowStore();
    const monitor = new FakeMonitorBackend();
    const svc = new FollowService({ store, monitor, now });
    const ref = externalArtistRef("Radiohead");

    await svc.follow(ref);

    expect(monitor.followCalls).toEqual(["Radiohead"]);
    expect(await store.has(followKey(ref))).toBe(true);
    const [rec] = await store.list();
    expect(rec).toMatchObject({ key: followKey(ref), kind: "artist", followedAt: NOW });
  });

  it("follow(artist) with NO monitor → local wishlist only", async () => {
    const store = new FakeFollowStore();
    const svc = new FollowService({ store, now });
    await svc.follow(externalArtistRef("Radiohead"));
    expect(await store.list()).toHaveLength(1);
  });

  it("follow(album) → store only, monitor untouched", async () => {
    const store = new FakeFollowStore();
    const monitor = new FakeMonitorBackend();
    const svc = new FollowService({ store, monitor, now });
    await svc.follow(entityRefForAlbum(ownedAlbum));
    expect(monitor.followCalls).toEqual([]);
    expect(await store.has(followKey(entityRefForAlbum(ownedAlbum)))).toBe(true);
  });

  it("isFollowed(artist) true when monitor says so even if not in store", async () => {
    const store = new FakeFollowStore();
    const monitor = new FakeMonitorBackend();
    await monitor.follow("Radiohead");
    const svc = new FollowService({ store, monitor, now });
    expect(await svc.isFollowed(externalArtistRef("Radiohead"))).toBe(true);
  });

  it("isFollowed(album) reads the store", async () => {
    const store = new FakeFollowStore();
    const svc = new FollowService({ store, now });
    expect(await svc.isFollowed(entityRefForAlbum(ownedAlbum))).toBe(false);
    await svc.follow(entityRefForAlbum(ownedAlbum));
    expect(await svc.isFollowed(entityRefForAlbum(ownedAlbum))).toBe(true);
  });

  it("unfollow(artist) with monitor → backend.unfollow + store removed", async () => {
    const store = new FakeFollowStore();
    const monitor = new FakeMonitorBackend();
    const svc = new FollowService({ store, monitor, now });
    const ref = externalArtistRef("Radiohead");
    await svc.follow(ref);
    await svc.unfollow(ref);
    expect(monitor.unfollowCalls).toEqual(["Radiohead"]);
    expect(await store.has(followKey(ref))).toBe(false);
  });

  it("listFollowed('artist') merges + dedups store and monitor", async () => {
    const store = new FakeFollowStore();
    const monitor = new FakeMonitorBackend();
    const svc = new FollowService({ store, monitor, now });
    // Followed via the service (lands in BOTH monitor + store).
    await svc.follow(externalArtistRef("Radiohead"));
    // A monitor-only artist (not in the local store).
    await monitor.follow("Aphex Twin");

    const followed = await svc.listFollowed("artist");
    const keys = followed.map(followKey).sort();
    expect(keys).toEqual([
      followKey(externalArtistRef("Aphex Twin")),
      followKey(externalArtistRef("Radiohead")),
    ]);
    // No duplicate for Radiohead despite being in both.
    expect(keys).toHaveLength(2);
  });

  it("listFollowed('album') returns only album refs from the store", async () => {
    const store = new FakeFollowStore();
    const monitor = new FakeMonitorBackend();
    const svc = new FollowService({ store, monitor, now });
    await svc.follow(entityRefForAlbum(ownedAlbum));
    await svc.follow(externalArtistRef("Radiohead"));
    const albums = await svc.listFollowed("album");
    expect(albums).toHaveLength(1);
    expect(albums[0]?.kind).toBe("album");
  });
});
