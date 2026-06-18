import type { EntityKind, EntityRef } from "../models/entity-ref.js";
import { externalArtistRef } from "../models/entity-ref.js";
import type { FollowRecord, FollowStore } from "../ports/follow-store.js";
import type { MonitorBackend } from "../ports/monitor-backend.js";
import { followKey } from "./entity-ref.js";

export interface FollowServiceDeps {
  store: FollowStore;
  monitor?: MonitorBackend;
  /** Injected clock — core never calls Date.now directly. Defaults to Date.now. */
  now?: () => number;
}

/** Unified follow facade: routes artist follows through the (optional) monitor
 *  backend + a local record; album/track follows are local favorites. */
export class FollowService {
  private readonly store: FollowStore;
  private readonly monitor?: MonitorBackend;
  private readonly now: () => number;

  constructor(deps: FollowServiceDeps) {
    this.store = deps.store;
    this.monitor = deps.monitor;
    this.now = deps.now ?? (() => Date.now());
  }

  async follow(ref: EntityRef): Promise<void> {
    if (ref.kind === "artist" && this.monitor) {
      await this.monitor.follow(ref.name);
    }
    const rec: FollowRecord = {
      key: followKey(ref),
      kind: ref.kind,
      ref,
      followedAt: this.now(),
    };
    await this.store.add(rec);
  }

  async unfollow(ref: EntityRef): Promise<void> {
    if (ref.kind === "artist" && this.monitor) {
      await this.monitor.unfollow(ref.name);
    }
    await this.store.remove(followKey(ref));
  }

  async isFollowed(ref: EntityRef): Promise<boolean> {
    if (ref.kind === "artist" && this.monitor) {
      if (await this.monitor.isFollowed(ref.name)) return true;
    }
    return this.store.has(followKey(ref));
  }

  async listFollowed(kind: EntityKind): Promise<EntityRef[]> {
    const local = (await this.store.list())
      .filter((r) => r.kind === kind)
      .map((r) => r.ref);
    if (kind !== "artist" || !this.monitor) return local;

    const byKey = new Map<string, EntityRef>();
    for (const ref of local) byKey.set(followKey(ref), ref);
    for (const name of await this.monitor.listFollowed()) {
      const ref = externalArtistRef(name);
      const key = followKey(ref);
      if (!byKey.has(key)) byKey.set(key, ref);
    }
    return [...byKey.values()];
  }
}
