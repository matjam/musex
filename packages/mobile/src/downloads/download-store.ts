import { Directory, File, Paths } from "expo-file-system";

/** A streaming writer for the AAC segment-stitch path: append bytes to a
 *  `.part` file, then atomically move it into place on commit. */
export interface StoreWriter {
  write(bytes: Uint8Array): void;
  commit(): Promise<void>;
  abort(): Promise<void>;
}

/** Pinned download storage in the app document directory (never evicted). Keyed
 *  by `downloadKey(serverId, plexPath)`. */
export class DownloadStore {
  private readonly dir = new Directory(Paths.document, "downloads");

  private ensureDir(): void {
    if (!this.dir.exists) this.dir.create();
  }

  has(key: string): boolean {
    return new File(this.dir, key).exists;
  }

  size(key: string): number {
    const f = new File(this.dir, key);
    return f.exists ? f.size : 0;
  }

  uri(key: string): string {
    return new File(this.dir, key).uri;
  }

  /** AAC path: append segment bytes to `<key>.part`, then move to `<key>`. */
  beginWrite(key: string): StoreWriter {
    this.ensureDir();
    const part = new File(this.dir, `${key}.part`);
    if (part.exists) part.delete();
    part.create();
    return {
      write: (bytes) => part.write(bytes, { append: true }),
      commit: async () => {
        const final = new File(this.dir, key);
        if (final.exists) final.delete();
        part.moveSync(final);
      },
      abort: async () => {
        if (part.exists) part.delete();
      },
    };
  }

  /** Original path: native download task to `<key>.part`, then move to `<key>`. */
  async downloadUrl(
    key: string,
    url: string,
    onProgress?: (bytesWritten: number, totalBytes: number) => void,
  ): Promise<number> {
    this.ensureDir();
    const part = new File(this.dir, `${key}.part`);
    if (part.exists) part.delete();
    const task = File.createDownloadTask(url, part, {
      onProgress: onProgress
        ? ({ bytesWritten, totalBytes }) => onProgress(bytesWritten, totalBytes)
        : undefined,
    });
    const downloaded = await task.downloadAsync();
    // downloadAsync() returns null if paused before completion
    const bytes = downloaded?.size ?? 0;
    if (bytes <= 0) {
      if (part.exists) part.delete();
      throw new Error("empty download");
    }
    const final = new File(this.dir, key);
    if (final.exists) final.delete();
    part.moveSync(final);
    return bytes;
  }

  remove(key: string): void {
    const f = new File(this.dir, key);
    if (f.exists) f.delete();
    const part = new File(this.dir, `${key}.part`);
    if (part.exists) part.delete();
  }

  /** Keys of present, non-empty, non-`.part` files (for reconcile + size totals). */
  presentNonEmptyKeys(): Set<string> {
    const keys = new Set<string>();
    if (!this.dir.exists) return keys;
    for (const entry of this.dir.list()) {
      if (entry instanceof File && entry.name && !entry.name.endsWith(".part") && entry.size > 0) {
        keys.add(entry.name);
      }
    }
    return keys;
  }

  totalBytes(): number {
    if (!this.dir.exists) return 0;
    let total = 0;
    for (const entry of this.dir.list()) {
      if (entry instanceof File && !entry.name.endsWith(".part")) total += entry.size;
    }
    return total;
  }
}

/** The interface the DownloadManager depends on (fake-able in tests). */
export type FileStore = Pick<
  DownloadStore,
  | "has"
  | "size"
  | "uri"
  | "beginWrite"
  | "downloadUrl"
  | "remove"
  | "presentNonEmptyKeys"
  | "totalBytes"
>;
