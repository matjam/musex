import { type DownloadRecord, isInFlight, reconcileRecords } from "@musex/core";
import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "musex.downloads-index";
// Coalesce index writes: enqueuing a whole library would otherwise re-serialize
// the entire (growing) index to AsyncStorage thousands of times. The in-memory
// map is the source of truth the UI reads; disk just needs to catch up.
const PERSIST_DEBOUNCE_MS = 600;

export class DownloadIndex {
  private map = new Map<string, DownloadRecord>();
  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  async load(): Promise<void> {
    try {
      const raw = await AsyncStorage.getItem(KEY);
      if (raw) for (const r of JSON.parse(raw) as DownloadRecord[]) this.map.set(r.key, r);
    } catch {
      /* fresh start */
    }
  }

  get(key: string): DownloadRecord | undefined {
    return this.map.get(key);
  }

  all(): DownloadRecord[] {
    return [...this.map.values()];
  }

  // upsert/remove mutate the in-memory map immediately (so the UI sees the change
  // at once) and schedule a debounced write. They stay async for call-site compat.
  async upsert(r: DownloadRecord): Promise<void> {
    this.map.set(r.key, r);
    this.schedulePersist();
  }

  async remove(key: string): Promise<void> {
    this.map.delete(key);
    this.schedulePersist();
  }

  /** Mark downloaded-but-vanished records missing (core reconcile). When
   *  `sizes` is supplied, a downloaded record whose on-disk size mismatches its
   *  expectedBytes is also demoted (partial/corrupt — the next sync re-queues it). */
  async reconcile(
    presentKeys: ReadonlySet<string>,
    sizes?: ReadonlyMap<string, number>,
  ): Promise<void> {
    const next = reconcileRecords(this.all(), presentKeys, sizes);
    this.map = new Map(next.map((r) => [r.key, r]));
    this.schedulePersist();
  }

  /** Resolve records left mid-flight by a previous run (nothing is actually
   *  downloading them on a fresh launch), SIZE-verified — mere file presence
   *  never promotes: a present file matching the record's expectedBytes (or a
   *  record with none) → downloaded, with bytes/expectedBytes set to the actual
   *  size (delivered size is authoritative, consistent with commit); a
   *  present-but-mismatched file is a partial — the record is dropped and the
   *  key RETURNED so the caller deletes the file; absent → dropped so the next
   *  sync re-queues it. This is what makes an interrupted sync resume without
   *  ever re-downloading a finished track — or trusting a half-committed one. */
  resolveStaleInFlight(sizes: ReadonlyMap<string, number>): string[] {
    const corrupt: string[] = [];
    let changed = false;
    for (const r of this.all()) {
      if (!isInFlight(r)) continue;
      changed = true;
      const size = sizes.get(r.key);
      if (size === undefined) {
        this.map.delete(r.key); // no file — drop; the next sync re-queues it
      } else if (r.expectedBytes === undefined || size === r.expectedBytes) {
        this.map.set(r.key, { ...r, state: "downloaded", bytes: size, expectedBytes: size });
      } else {
        this.map.delete(r.key);
        corrupt.push(r.key); // partial file on disk — caller deletes it
      }
    }
    if (changed) this.schedulePersist();
    return corrupt;
  }

  /** Force any pending write to disk now (e.g. before teardown). */
  async flush(): Promise<void> {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    await this.persist();
  }

  private schedulePersist(): void {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      void this.persist();
    }, PERSIST_DEBOUNCE_MS);
  }

  private async persist(): Promise<void> {
    try {
      await AsyncStorage.setItem(KEY, JSON.stringify(this.all()));
    } catch (err) {
      console.warn("[downloads] index persist failed", err);
    }
  }
}
