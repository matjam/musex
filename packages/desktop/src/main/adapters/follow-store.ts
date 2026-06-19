import type { FollowRecord, FollowStore } from "@musex/core";

/** Minimal persistence seam the FollowStore needs — satisfied by electron-store
 *  in the Runtime (a `follows` key holding the FollowRecord array) and by a
 *  plain in-memory object in tests. */
export interface FollowPersistence {
  get(): FollowRecord[];
  set(records: FollowRecord[]): void;
}

/**
 * electron-store-backed FollowStore (SP0 port): persists per-device follows /
 * favorites as a flat FollowRecord array under one key. The store object is
 * injected so unit tests can pass a fake (no electron runtime needed) — the same
 * pattern as DownloadIndex.
 */
export class ElectronFollowStore implements FollowStore {
  constructor(private readonly persistence: FollowPersistence) {}

  async init(): Promise<void> {
    // electron-store hydrates synchronously from disk on construction; nothing
    // to do here. Present to satisfy the port (mobile's async-storage adapter
    // will load in init()).
  }

  async list(): Promise<FollowRecord[]> {
    return this.persistence.get();
  }

  async add(rec: FollowRecord): Promise<void> {
    const all = this.persistence.get();
    // Dedup by key: re-following replaces the existing record (e.g. a fresh
    // followedAt) rather than duplicating it.
    const next = all.filter((r) => r.key !== rec.key);
    next.push(rec);
    this.persistence.set(next);
  }

  async remove(key: string): Promise<void> {
    const all = this.persistence.get();
    const next = all.filter((r) => r.key !== key);
    // Avoid a needless write when nothing matched.
    if (next.length !== all.length) this.persistence.set(next);
  }

  async has(key: string): Promise<boolean> {
    return this.persistence.get().some((r) => r.key === key);
  }
}
