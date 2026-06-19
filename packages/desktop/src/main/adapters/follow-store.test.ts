import type { EntityRef, FollowRecord } from "@musex/core";
import { describe, expect, it } from "vitest";
import { ElectronFollowStore, type FollowPersistence } from "./follow-store.js";

/** A fake of the electron-store persistence seam, holding the array in memory. */
function fakePersistence(initial: FollowRecord[] = []): FollowPersistence & {
  raw: () => FollowRecord[];
} {
  let records = [...initial];
  return {
    get: () => records,
    set: (next) => {
      records = next;
    },
    raw: () => records,
  };
}

const artistRef: EntityRef = { kind: "artist", source: "external", name: "Radiohead" };
const albumRef: EntityRef = {
  kind: "album",
  source: "plex",
  id: "al1",
  serverId: "s1",
  name: "OK Computer",
};

const rec = (key: string, ref: EntityRef): FollowRecord => ({
  key,
  kind: ref.kind,
  ref,
  followedAt: 100,
});

describe("ElectronFollowStore", () => {
  it("round-trips add → has → list → remove", async () => {
    const p = fakePersistence();
    const store = new ElectronFollowStore(p);
    await store.init();

    expect(await store.has("artist:external:radiohead")).toBe(false);
    await store.add(rec("artist:external:radiohead", artistRef));
    expect(await store.has("artist:external:radiohead")).toBe(true);
    expect(await store.list()).toHaveLength(1);

    await store.add(rec("album:plex:al1", albumRef));
    expect(await store.list()).toHaveLength(2);

    await store.remove("artist:external:radiohead");
    expect(await store.has("artist:external:radiohead")).toBe(false);
    expect(await store.list()).toHaveLength(1);
    expect((await store.list())[0]?.key).toBe("album:plex:al1");
  });

  it("dedups by key (re-adding replaces, not duplicates)", async () => {
    const p = fakePersistence();
    const store = new ElectronFollowStore(p);
    await store.add({ ...rec("k", artistRef), followedAt: 1 });
    await store.add({ ...rec("k", artistRef), followedAt: 2 });
    const list = await store.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.followedAt).toBe(2);
  });

  it("survives a reload (a new store over the same persistence sees prior records)", async () => {
    const p = fakePersistence();
    const first = new ElectronFollowStore(p);
    await first.add(rec("album:plex:al1", albumRef));

    const reopened = new ElectronFollowStore(p);
    await reopened.init();
    expect(await reopened.has("album:plex:al1")).toBe(true);
    expect(await reopened.list()).toHaveLength(1);
  });

  it("remove of an absent key is a no-op (no write)", async () => {
    let writes = 0;
    const inner = fakePersistence([rec("a", artistRef)]);
    const counting: FollowPersistence = {
      get: inner.get,
      set: (next) => {
        writes++;
        inner.set(next);
      },
    };
    const store = new ElectronFollowStore(counting);
    await store.remove("does-not-exist");
    expect(writes).toBe(0);
    expect(await store.list()).toHaveLength(1);
  });
});
