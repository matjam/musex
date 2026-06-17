import { randomBytes } from "node:crypto";
import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir, readdir, rename, rm, stat, unlink } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";

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
    // failed; commit() discards the temp and rejects so the DownloadManager
    // records the job as failed (a silent return would falsely mark it
    // "downloaded" while the file isn't on disk).
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
          // The caller writes then end()s the stream; commit waits for the
          // flush ('finish') before renaming so the published file is complete.
          // The writableFinished guard tolerates an already-ended stream (the
          // common case) without re-calling end(); resolve on error too so we
          // never hang.
          await new Promise<void>((resolve) => {
            if (stream.writableFinished) return resolve();
            stream.once("error", () => resolve());
            stream.end(() => resolve());
          });
        }
        if (failed) {
          await removeTmp();
          throw new Error(`download write failed for ${key}`);
        }
        try {
          await rename(tmp, dest); // atomic publish (overwrites a prior copy)
        } catch (err) {
          await removeTmp();
          throw err instanceof Error ? err : new Error(String(err));
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
    // Defense in depth: `key` ultimately drives rm(join(dir, key)). Keys are
    // cacheKey() sha256 hex digests; reject anything that could traverse out of
    // the store, so a bad key can never delete a file outside `dir`.
    const target = this.full(key);
    if (relative(this.dir, target).startsWith("..") || isAbsolute(relative(this.dir, target))) {
      throw new Error(`refusing to remove key outside store: ${key}`);
    }
    await rm(target, { force: true });
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
