import type { DownloadRecord } from "@musex/core";

/**
 * In-memory index of DownloadRecords, backed by an injectable persistence hook.
 * The runtime wires the real electron-store persistence; unit tests pass a no-op
 * or spy so no electron runtime is needed.
 */
export class DownloadIndex {
  private readonly map = new Map<string, DownloadRecord>();

  constructor(
    initial: DownloadRecord[],
    private readonly persist: (all: DownloadRecord[]) => void,
  ) {
    for (const r of initial) this.map.set(r.key, r);
  }

  get(key: string): DownloadRecord | undefined {
    return this.map.get(key);
  }

  list(): DownloadRecord[] {
    return [...this.map.values()];
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  upsert(record: DownloadRecord): void {
    this.map.set(record.key, record);
    this.persist(this.list());
  }

  remove(key: string): void {
    this.map.delete(key);
    this.persist(this.list());
  }
}
