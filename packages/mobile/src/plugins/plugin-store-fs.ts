/**
 * Runtime FsOps implementation over the SDK-56 expo-file-system new API
 * (`File`/`Directory`/`Paths`). Kept in its own module so the native import
 * never reaches `plugin-store.ts` (which is unit-tested under vitest/node with
 * a fake FsOps).
 */

import { Directory, File, Paths } from "expo-file-system";
import type { FsOps } from "./plugin-store.js";

export const expoFsOps: FsOps = {
  ensureDir(id) {
    const root = new Directory(Paths.document, "plugins");
    if (!root.exists) root.create();
    const dir = new Directory(root, id);
    if (!dir.exists) dir.create();
  },
  writeFile(id, name, bytes) {
    const dir = new Directory(Paths.document, "plugins", id);
    const file = new File(dir, name);
    if (file.exists) file.delete();
    file.create();
    file.write(bytes);
  },
  readText(id, name) {
    const file = new File(new Directory(Paths.document, "plugins", id), name);
    return file.textSync();
  },
  removeDir(id) {
    const dir = new Directory(Paths.document, "plugins", id);
    if (dir.exists) dir.delete();
  },
  listDirs() {
    const root = new Directory(Paths.document, "plugins");
    if (!root.exists) return [];
    return root
      .list()
      .filter((e): e is Directory => e instanceof Directory)
      .map((d) => d.name);
  },
};
