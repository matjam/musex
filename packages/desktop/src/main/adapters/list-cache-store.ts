import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

interface Entry<T> {
  validator: string;
  ts: number;
  data: T;
}

/** Disk-persisted JSON cache for list results, validator-keyed. All file ops are
 *  confined to `dir`. A small in-memory layer fronts disk for same-session hits. */
export class ListCacheStore {
  private readonly mem = new Map<string, Entry<unknown>>();
  /** Maps SHA-256 hex (filename stem) → original key, for mem eviction. */
  private readonly hashToKey = new Map<string, string>();
  constructor(
    private readonly dir: string,
    private readonly maxEntries = 200,
  ) {}

  async init(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
  }

  private hash(key: string): string {
    return createHash("sha256").update(key).digest("hex");
  }

  private file(key: string): string {
    return path.join(this.dir, `${this.hash(key)}.json`);
  }

  /** Cached data if present AND the validator matches; else null. */
  async get<T>(key: string, validator: string): Promise<T | null> {
    const cached = this.mem.get(key);
    if (cached) return cached.validator === validator ? (cached.data as T) : null;
    let raw: string;
    try {
      raw = await readFile(this.file(key), "utf8");
    } catch {
      return null; // not on disk
    }
    let entry: Entry<T>;
    try {
      entry = JSON.parse(raw) as Entry<T>;
    } catch {
      return null; // corrupt entry — treat as miss
    }
    this.mem.set(key, entry);
    this.hashToKey.set(this.hash(key), key);
    return entry.validator === validator ? entry.data : null;
  }

  async set<T>(key: string, validator: string, data: T): Promise<void> {
    const entry: Entry<T> = { validator, ts: Date.now(), data };
    this.mem.set(key, entry);
    this.hashToKey.set(this.hash(key), key);
    try {
      await writeFile(this.file(key), JSON.stringify(entry));
    } catch (err) {
      console.error("[musex list-cache] write failed:", err);
      return;
    }
    await this.evict();
  }

  async evictKey(key: string): Promise<void> {
    const h = this.hash(key);
    this.mem.delete(key);
    this.hashToKey.delete(h);
    try {
      await unlink(this.file(key));
    } catch {
      // already gone — benign race, no action needed
    }
  }

  /** Drop oldest-`ts` files beyond the cap. */
  private async evict(): Promise<void> {
    let names: string[];
    try {
      names = (await readdir(this.dir)).filter((n) => n.endsWith(".json"));
    } catch {
      return;
    }
    if (names.length <= this.maxEntries) return;
    const withTimes: { name: string; ts: number }[] = [];
    for (const name of names) {
      try {
        const s = await stat(path.join(this.dir, name));
        withTimes.push({ name, ts: s.mtimeMs });
      } catch {
        // racing deletion — benign, skip this entry
      }
    }
    withTimes.sort((a, b) => a.ts - b.ts);
    for (const { name } of withTimes.slice(0, withTimes.length - this.maxEntries)) {
      try {
        await unlink(path.join(this.dir, name));
      } catch {
        // already gone — benign race, no action needed
      }
      // Also evict from the in-memory layer using the reverse hash map.
      const stem = name.slice(0, -5); // strip ".json"
      const origKey = this.hashToKey.get(stem);
      if (origKey !== undefined) {
        this.mem.delete(origKey);
        this.hashToKey.delete(stem);
      }
    }
  }

  async clear(): Promise<void> {
    this.mem.clear();
    this.hashToKey.clear();
    try {
      await rm(this.dir, { recursive: true, force: true });
      await mkdir(this.dir, { recursive: true });
    } catch (err) {
      console.error("[musex list-cache] clear failed:", err);
    }
  }
}
