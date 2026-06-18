/**
 * PluginFileStore — the on-device plugin bundle directory
 * (`<documentDirectory>/plugins/<id>/`). Each installed plugin gets a directory
 * holding its whitelisted files (`plugin.json` + the manifest `entry`).
 *
 * All expo-file-system access goes through an injectable `FsOps` interface so
 * the unit tests run with an in-memory fake (the native module cannot load
 * under vitest/node). The real implementation (`expoFsOps`) is wired in by the
 * store provider at runtime.
 *
 * Safety: `writePlugin`/`readEntry`/`removePlugin` validate `isSafePluginId`
 * (the id reaches the installer from a user-pasted repo / IPC) and the file
 * store roots everything under a per-id directory, so a bad id can never escape
 * the plugins root.
 */

import { isSafeEntryName, isSafePluginId } from "@musex/core";

/** Minimal filesystem the store needs — implemented over expo-file-system at
 *  runtime, faked in tests. All paths are directory/file names RELATIVE to the
 *  plugins root; the impl resolves them under the document directory. */
export interface FsOps {
  /** Ensure the plugins root + `plugins/<id>/` exist (idempotent). */
  ensureDir(id: string): void;
  /** Overwrite `plugins/<id>/<name>` with `bytes`. */
  writeFile(id: string, name: string, bytes: Uint8Array): void;
  /** Read `plugins/<id>/<name>` as UTF-8 text. Throws if absent. */
  readText(id: string, name: string): string;
  /** Recursively remove `plugins/<id>/`. */
  removeDir(id: string): void;
  /** Directory names directly under the plugins root. */
  listDirs(): string[];
}

export class PluginFileStore {
  constructor(private readonly fs: FsOps) {}

  /** The directory segment for a plugin id (validated). */
  pluginDir(id: string): string {
    if (!isSafePluginId(id)) throw new Error(`invalid plugin id: ${id}`);
    return id;
  }

  /** Write a plugin's whitelisted files. The caller (installer) is responsible
   *  for the content whitelist; this guards the id + each file name. */
  async writePlugin(id: string, files: Record<string, Uint8Array>): Promise<void> {
    if (!isSafePluginId(id)) throw new Error(`invalid plugin id: ${id}`);
    // Replace any prior install of this id.
    this.fs.removeDir(id);
    this.fs.ensureDir(id);
    for (const [name, bytes] of Object.entries(files)) {
      if (!isSafeEntryName(name)) throw new Error(`unsafe entry name: ${name}`);
      this.fs.writeFile(id, name, bytes);
    }
  }

  /** Read a plugin's entry module source (UTF-8). */
  async readEntry(id: string, entry: string): Promise<string> {
    if (!isSafePluginId(id)) throw new Error(`invalid plugin id: ${id}`);
    if (!isSafeEntryName(entry)) throw new Error(`unsafe entry name: ${entry}`);
    return this.fs.readText(id, entry);
  }

  async removePlugin(id: string): Promise<void> {
    if (!isSafePluginId(id)) throw new Error(`invalid plugin id: ${id}`);
    this.fs.removeDir(id);
  }

  /** Installed plugin ids (directory names under the plugins root). */
  async list(): Promise<string[]> {
    return this.fs.listDirs().filter((n) => isSafePluginId(n));
  }
}
