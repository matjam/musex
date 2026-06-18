import type { EntityKind, EntityRef } from "../models/entity-ref.js";

export interface FollowRecord {
  key: string;
  kind: EntityKind;
  ref: EntityRef;
  followedAt: number;
}

/** Per-device persistence of follows/favorites (electron-store on desktop,
 *  async-storage on mobile — adapters land in SP1/SP2). */
export interface FollowStore {
  init(): Promise<void>;
  list(): Promise<FollowRecord[]>;
  add(rec: FollowRecord): Promise<void>;
  remove(key: string): Promise<void>;
  has(key: string): Promise<boolean>;
}
