import type { ListCache } from "@musex/core";

/** The injectable filesystem seam. The real implementation
 *  (`mobile-list-cache-fs.ts`) is over expo-file-system; tests pass a fake so no
 *  native module loads. Filenames are the hashed cache keys (`<sha256>.json`). */
export interface FsOps {
  /** Ensure the cache directory exists. */
  ensureDir(): Promise<void>;
  /** Read a file's text, or null if absent / unreadable. */
  read(name: string): Promise<string | null>;
  /** Write (overwrite) a file's text. */
  write(name: string, text: string): Promise<void>;
  /** Remove a file (no-op if absent). */
  remove(name: string): Promise<void>;
  /** List the filenames present in the cache directory. */
  list(): Promise<string[]>;
  /** A file's last-modified time in epoch ms (for LRU), or null if absent. */
  stat(name: string): Promise<number | null>;
  /** Remove every file in the cache directory. */
  clearAll(): Promise<void>;
}

interface Entry<T> {
  validator: string;
  ts: number;
  data: T;
}

const DEFAULT_MAX_ENTRIES = 200;

/** A `ListCache` over an injectable `FsOps`, with an in-memory tier in front of
 *  the filesystem. `get` enforces the validator; `getStale` ignores it
 *  (offline-serve). Filenames are `${sha256(key)}.json`. `set` LRU-evicts beyond
 *  `maxEntries` by on-disk mtime. Corrupt JSON is treated as a miss. */
export class MobileListCache implements ListCache {
  private readonly mem = new Map<string, Entry<unknown>>();

  constructor(
    private readonly fs: FsOps,
    private readonly sha256: (s: string) => string,
    private readonly maxEntries: number = DEFAULT_MAX_ENTRIES,
  ) {}

  async init(): Promise<void> {
    await this.fs.ensureDir();
  }

  private fileName(key: string): string {
    return `${this.sha256(key)}.json`;
  }

  /** Read the entry for a key from the mem tier, falling through to disk.
   *  Corrupt JSON yields null. Populates the mem tier on a disk hit. */
  private async load<T>(key: string): Promise<Entry<T> | null> {
    const cached = this.mem.get(key);
    if (cached) return cached as Entry<T>;
    const text = await this.fs.read(this.fileName(key));
    if (text === null) return null;
    try {
      const entry = JSON.parse(text) as Entry<T>;
      this.mem.set(key, entry as Entry<unknown>);
      return entry;
    } catch {
      // Corrupt entry -> miss (do NOT throw; a damaged cache file is recoverable
      // by refetching online or treating offline as unavailable).
      return null;
    }
  }

  async get<T>(key: string, validator: string): Promise<T | null> {
    const entry = await this.load<T>(key);
    if (entry === null) return null;
    return entry.validator === validator ? entry.data : null;
  }

  async getStale<T>(key: string): Promise<T | null> {
    const entry = await this.load<T>(key);
    return entry === null ? null : entry.data;
  }

  async set<T>(key: string, validator: string, data: T): Promise<void> {
    const entry: Entry<T> = { validator, ts: Date.now(), data };
    this.mem.set(key, entry as Entry<unknown>);
    await this.fs.write(this.fileName(key), JSON.stringify(entry));
    await this.evictLru();
  }

  async evictKey(key: string): Promise<void> {
    this.mem.delete(key);
    await this.fs.remove(this.fileName(key));
  }

  async clear(): Promise<void> {
    this.mem.clear();
    await this.fs.clearAll();
  }

  /** Drop the oldest files (by mtime) once the directory exceeds `maxEntries`. */
  private async evictLru(): Promise<void> {
    const names = await this.fs.list();
    if (names.length <= this.maxEntries) return;
    const stats = await Promise.all(
      names.map(async (name) => ({ name, mtime: (await this.fs.stat(name)) ?? 0 })),
    );
    stats.sort((a, b) => a.mtime - b.mtime); // oldest first
    const dropCount = stats.length - this.maxEntries;
    for (let i = 0; i < dropCount; i++) {
      const victim = stats[i];
      if (!victim) continue;
      await this.fs.remove(victim.name);
      // The mem tier is keyed by the unhashed key; we only hold the filename
      // here, so drop the mem entry whose hashed name matches.
      this.dropMemByFile(victim.name);
    }
  }

  private dropMemByFile(name: string): void {
    for (const key of this.mem.keys()) {
      if (this.fileName(key) === name) {
        this.mem.delete(key);
        return;
      }
    }
  }
}
