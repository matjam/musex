import { randomBytes } from "node:crypto";
import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir, readdir, rename, stat, unlink, utimes } from "node:fs/promises";
import path from "node:path";
import { selectEvictions } from "../../logic/cache.js";

export interface CacheStats {
  bytes: number;
  files: number;
}

/** A single in-progress write-through download. */
export interface CacheWriter {
  stream: WriteStream;
  /** Finish the file and atomically publish it, then run eviction. */
  commit(): Promise<void>;
  /** Discard the in-progress file (e.g. download aborted/skipped). */
  abort(): Promise<void>;
}

/**
 * Filesystem media cache. Every operation is confined to `dir`; eviction and
 * clear only ever unlink files inside it.
 *
 * A complete entry is a file named exactly `<key>`. In-progress writes go to
 * `<key>.<rand>.part` and are renamed into place on commit, so an aborted or
 * partial download never appears as a complete entry.
 */
export class MediaCache {
  constructor(private readonly dir: string) {}

  async init(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
  }

  private full(name: string): string {
    return path.join(this.dir, name);
  }

  /** Path to a complete entry if present (bumping its mtime for LRU), else null. */
  async pathIfPresent(key: string): Promise<string | null> {
    const p = this.full(key);
    try {
      await stat(p);
    } catch {
      return null; // not cached
    }
    const now = new Date();
    try {
      await utimes(p, now, now); // touch -> "recently used" for LRU
    } catch {
      // touch failure is non-fatal — we can still serve the file
    }
    return p;
  }

  /** Begin a write-through download for `key`. */
  beginWrite(key: string, maxBytes: number): CacheWriter {
    const tmp = this.full(`${key}.${randomBytes(8).toString("hex")}.part`);
    const dest = this.full(key);
    const stream = createWriteStream(tmp);
    let settled = false;
    let failed = false;

    const removeTmp = async () => {
      try {
        await unlink(tmp);
      } catch {
        // already gone — nothing to clean up
      }
    };

    // A write error (disk full, EACCES, …) must never bubble up as an unhandled
    // 'error' event — that is fatal in Electron's main process. Mark the writer
    // failed; commit/abort discard the temp. The client response is a separate
    // pipe, so playback continues (just uncached).
    //
    // ERR_STREAM_DESTROYED is expected and benign: aborting a write (track change,
    // prefetch cancel) calls destroy() while best-effort chunks are still buffered,
    // and each buffered write then errors in its async fs callback. We're discarding
    // the temp anyway, so swallow that specific code and only surface real I/O errors.
    stream.on("error", (err) => {
      failed = true;
      if ((err as NodeJS.ErrnoException).code !== "ERR_STREAM_DESTROYED") {
        console.error("[musex cache] write failed:", err);
      }
    });

    return {
      stream,
      commit: async () => {
        if (settled) return;
        settled = true;
        if (!failed) {
          // We piped with { end: false }, so commit owns the single end() and
          // waits for the flush ('finish') before renaming — guaranteeing the
          // published file is complete. Resolve on error too, so we never hang.
          await new Promise<void>((resolve) => {
            stream.once("error", () => resolve());
            stream.end(() => resolve());
          });
        }
        if (failed) {
          await removeTmp();
          return;
        }
        try {
          await rename(tmp, dest); // atomic publish (overwrites a prior copy)
        } catch (err) {
          console.error("[musex cache] commit failed:", err);
          await removeTmp();
          return;
        }
        await this.evict(maxBytes);
      },
      abort: async () => {
        if (settled) return;
        settled = true;
        stream.destroy();
        await removeTmp();
      },
    };
  }

  /** Complete entries (excludes in-progress `.part` files). */
  private async entries(): Promise<{ name: string; size: number; mtimeMs: number }[]> {
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch {
      return []; // dir missing -> empty cache
    }
    const out: { name: string; size: number; mtimeMs: number }[] = [];
    for (const name of names) {
      if (name.endsWith(".part")) continue;
      try {
        const s = await stat(this.full(name));
        if (s.isFile()) out.push({ name, size: s.size, mtimeMs: s.mtimeMs });
      } catch {
        // racing deletion — entry vanished, skip it
      }
    }
    return out;
  }

  /** Delete least-recently-used entries until total size is within `maxBytes`. */
  async evict(maxBytes: number): Promise<void> {
    const entries = await this.entries();
    for (const name of selectEvictions(entries, maxBytes)) {
      try {
        await unlink(this.full(name));
      } catch {
        // racing deletion — already gone
      }
    }
  }

  /** Remove all entries (and orphaned temp files); return bytes freed. */
  async clear(): Promise<number> {
    const entries = await this.entries();
    let freed = 0;
    for (const e of entries) {
      try {
        await unlink(this.full(e.name));
        freed += e.size;
      } catch {
        // racing deletion — already gone
      }
    }
    try {
      for (const name of await readdir(this.dir)) {
        if (!name.endsWith(".part")) continue;
        try {
          await unlink(this.full(name));
        } catch {
          // already gone
        }
      }
    } catch {
      // dir missing — nothing to clean
    }
    return freed;
  }

  async stats(): Promise<CacheStats> {
    const entries = await this.entries();
    let bytes = 0;
    for (const e of entries) bytes += e.size;
    return { bytes, files: entries.length };
  }
}
