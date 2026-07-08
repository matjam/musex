import type { DownloadRecord } from "@musex/core";
import { Directory, File, Paths } from "expo-file-system";
import {
  convertedFileName,
  isConvertedFileName,
  keyForDiskName,
  keyForFileName,
  storeFileName,
} from "./store-filename";

/** A streaming writer for the AAC segment-stitch path: append bytes to a
 *  `.part` file, then atomically move it into place on commit. */
export interface StoreWriter {
  write(bytes: Uint8Array): void;
  commit(): Promise<void>;
  abort(): Promise<void>;
}

/** Pinned download storage in the app document directory (never evicted). Keyed
 *  by `downloadKey(serverId, plexPath)`; stored under the FLAT reversible
 *  filename `storeFileName(key)` (the raw key contains `/` — see store-filename).
 *  A key's artifact lives under ONE of two names: the bare flat name (originals,
 *  HLS-stitched files) or `convertedFileName(key)` = `<flat>.conv.m4a` (on-device
 *  AAC conversions — AVPlayer needs the m4a extension; see store-filename). The
 *  read paths prefer the converted name when both exist. */
export class DownloadStore {
  private readonly dir = new Directory(Paths.document, "downloads");

  private ensureDir(): void {
    if (!this.dir.exists) this.dir.create();
  }

  has(key: string): boolean {
    return (
      new File(this.dir, convertedFileName(key)).exists ||
      new File(this.dir, storeFileName(key)).exists
    );
  }

  size(key: string): number {
    const conv = new File(this.dir, convertedFileName(key));
    if (conv.exists) return conv.size;
    const f = new File(this.dir, storeFileName(key));
    return f.exists ? f.size : 0;
  }

  uri(key: string): string {
    const conv = new File(this.dir, convertedFileName(key));
    if (conv.exists) return conv.uri;
    return new File(this.dir, storeFileName(key)).uri;
  }

  /** Absolute filesystem path for a key's BARE final file (no file:// scheme) —
   *  what native/JS engines write to (`path + ".part"` during transfer). Stays
   *  the bare flat name: the DownloadManager appends CONVERTED_SUFFIX itself for
   *  convert jobs' destPath, and Swift derives every temp name from destPath. The
   *  directory part of the uri is percent-DECODED to a real path; the flat
   *  `storeFileName(key)` is appended raw because it IS the on-disk bytes
   *  (decoding it would resurrect the slashes the flattening removed). */
  path(key: string): string {
    const dirUri = this.dir.uri;
    const dirPath = dirUri.startsWith("file://")
      ? decodeURI(dirUri.slice("file://".length))
      : dirUri;
    return `${dirPath.endsWith("/") ? dirPath : `${dirPath}/`}${storeFileName(key)}`;
  }

  /** AAC path: append segment bytes to `<name>.part`, then move to `<name>`. */
  beginWrite(key: string): StoreWriter {
    this.ensureDir();
    const name = storeFileName(key);
    const part = new File(this.dir, `${name}.part`);
    if (part.exists) part.delete();
    part.create();
    return {
      write: (bytes) => part.write(bytes, { append: true }),
      commit: async () => {
        const final = new File(this.dir, name);
        if (final.exists) final.delete();
        part.moveSync(final);
      },
      abort: async () => {
        if (part.exists) part.delete();
      },
    };
  }

  /** Original path: native download task to `<name>.part`, then move to `<name>`. */
  async downloadUrl(
    key: string,
    url: string,
    onProgress?: (bytesWritten: number, totalBytes: number) => void,
  ): Promise<number> {
    this.ensureDir();
    const name = storeFileName(key);
    const part = new File(this.dir, `${name}.part`);
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
    const final = new File(this.dir, name);
    if (final.exists) final.delete();
    part.moveSync(final);
    return bytes;
  }

  remove(key: string): void {
    for (const name of [storeFileName(key), convertedFileName(key)]) {
      const f = new File(this.dir, name);
      if (f.exists) f.delete();
      const part = new File(this.dir, `${name}.part`);
      if (part.exists) part.delete();
    }
  }

  /** Sizes of present non-.part files, for size-verified reconcile. On-disk
   *  names are the flattened `storeFileName(key)` or the converted
   *  `<flat>.conv.m4a`, so decode them back to the download keys that reconcile
   *  compares against records (converted strips the suffix first). When BOTH
   *  names exist for a key the converted entry wins — it is what `uri()` serves. */
  presentFileSizes(): Map<string, number> {
    const sizes = new Map<string, number>();
    if (!this.dir.exists) return sizes;
    for (const entry of this.dir.list()) {
      if (entry instanceof File && entry.name && !entry.name.endsWith(".part") && entry.size > 0) {
        const key = keyForDiskName(entry.name);
        // Converted always sets; bare only fills a gap (listing order varies).
        if (isConvertedFileName(entry.name) || !sizes.has(key)) sizes.set(key, entry.size);
      }
    }
    return sizes;
  }

  /** One-shot bootstrap migration: converted artifacts used to be committed to
   *  the BARE flat name, whose extension is the SOURCE file's (e.g. `….flac`) —
   *  AVPlayer infers a local file's format from the extension and refused to
   *  play the m4a bytes inside. For every record the index says is a committed
   *  m4a (`downloaded` + `meta.container === "m4a"`), rename the bare file to
   *  the reserved `.conv.m4a` name. Deliberately NOT touched: legacy/ongoing
   *  HLS-stitched files (records whose meta kept the source container) — their
   *  playability is a separate open question. Returns the rename count. */
  migrateConvertedNames(records: DownloadRecord[]): number {
    if (!this.dir.exists) return 0;
    let renamed = 0;
    for (const r of records) {
      if (r.state !== "downloaded" || r.meta.container !== "m4a") continue;
      const bare = new File(this.dir, storeFileName(r.key));
      if (!bare.exists) continue;
      const conv = new File(this.dir, convertedFileName(r.key));
      if (conv.exists) continue;
      bare.moveSync(conv);
      renamed += 1;
    }
    return renamed;
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
  | "path"
  | "beginWrite"
  | "downloadUrl"
  | "remove"
  | "presentFileSizes"
  | "totalBytes"
>;
