import { randomBytes } from "node:crypto";
import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir, readdir, rename, rm, stat, unlink } from "node:fs/promises";
import { join } from "node:path";

export interface StoreWriter {
  stream: WriteStream;
  /** Finish the file and atomically publish it. */
  commit(): Promise<void>;
  /** Discard the in-progress file (e.g. download aborted). */
  abort(): Promise<void>;
}

export interface StoreStats {
  bytes: number;
  files: number;
}

/**
 * Pinned on-disk store for downloaded media. Same atomic-write discipline as
 * MediaCache (.part → rename on commit), but never evicts. Keyed by
 * cacheKey(serverId, plexPath) — the same hex key the stream proxy uses.
 */
export class DownloadStore {
  constructor(private readonly dir: string) {}

  async init(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
  }

  private full(name: string): string {
    return join(this.dir, name);
  }

  /** Path to a stored file if present, else null. */
  async pathIfPresent(key: string): Promise<string | null> {
    const p = this.full(key);
    try {
      await stat(p);
    } catch {
      return null;
    }
    return p;
  }

  async has(key: string): Promise<boolean> {
    return (await this.pathIfPresent(key)) !== null;
  }

  /** Begin an atomic write for `key`. Write to `.stream`, then call `commit()` or `abort()`. */
  beginWrite(key: string): StoreWriter {
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
    // pipe so playback continues (just unsaved).
    //
    // ERR_STREAM_DESTROYED is expected and benign: aborting a write calls
    // destroy() while buffered chunks are still flushing; each then errors.
    // We're discarding the temp anyway, so swallow that specific code.
    stream.on("error", (err) => {
      failed = true;
      if ((err as NodeJS.ErrnoException).code !== "ERR_STREAM_DESTROYED") {
        console.error("[musex download-store] write failed:", err);
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
          console.error("[musex download-store] commit failed:", err);
          await removeTmp();
          return;
        }
      },
      abort: async () => {
        if (settled) return;
        settled = true;
        stream.destroy();
        await removeTmp();
      },
    };
  }

  async remove(key: string): Promise<void> {
    await rm(this.full(key), { force: true });
  }

  /** Complete entries (excludes in-progress `.part` files). */
  async listKeys(): Promise<string[]> {
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch {
      return [];
    }
    return names.filter((n) => !n.endsWith(".part"));
  }

  async stats(): Promise<StoreStats> {
    const keys = await this.listKeys();
    let bytes = 0;
    for (const k of keys) {
      try {
        bytes += (await stat(this.full(k))).size;
      } catch {
        // racing deletion — skip
      }
    }
    return { bytes, files: keys.length };
  }
}
