import { type DownloadRecord, reconcileRecords } from "@musex/core";
import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "musex.downloads-index";

export class DownloadIndex {
  private map = new Map<string, DownloadRecord>();

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

  async upsert(r: DownloadRecord): Promise<void> {
    this.map.set(r.key, r);
    await this.persist();
  }

  async remove(key: string): Promise<void> {
    this.map.delete(key);
    await this.persist();
  }

  async reconcile(presentKeys: ReadonlySet<string>): Promise<void> {
    const next = reconcileRecords(this.all(), presentKeys);
    this.map = new Map(next.map((r) => [r.key, r]));
    await this.persist();
  }

  private async persist(): Promise<void> {
    try {
      await AsyncStorage.setItem(KEY, JSON.stringify(this.all()));
    } catch (err) {
      console.warn("[downloads] index persist failed", err);
    }
  }
}
