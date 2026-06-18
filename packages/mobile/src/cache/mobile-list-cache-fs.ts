import { Directory, File, Paths } from "expo-file-system";
import type { FsOps } from "./mobile-list-cache";

/** The real `FsOps` over the SDK-56 expo-file-system `File`/`Directory`/`Paths`
 *  API. Lives in the app document directory under `list-cache/`. NOT imported by
 *  the unit test (it pulls in the native module). All ops are synchronous under
 *  the hood; wrapped in async to satisfy the port. */
export class ExpoListCacheFs implements FsOps {
  private readonly dir = new Directory(Paths.document, "list-cache");

  async ensureDir(): Promise<void> {
    if (!this.dir.exists) this.dir.create();
  }

  async read(name: string): Promise<string | null> {
    const f = new File(this.dir, name);
    if (!f.exists) return null;
    try {
      return f.textSync();
    } catch {
      return null;
    }
  }

  async write(name: string, text: string): Promise<void> {
    if (!this.dir.exists) this.dir.create();
    const f = new File(this.dir, name);
    if (!f.exists) f.create();
    f.write(text);
  }

  async remove(name: string): Promise<void> {
    const f = new File(this.dir, name);
    if (f.exists) f.delete();
  }

  async list(): Promise<string[]> {
    if (!this.dir.exists) return [];
    const out: string[] = [];
    for (const entry of this.dir.list()) {
      if (entry instanceof File && entry.name) out.push(entry.name);
    }
    return out;
  }

  async stat(name: string): Promise<number | null> {
    const f = new File(this.dir, name);
    if (!f.exists) return null;
    return f.lastModified;
  }

  async clearAll(): Promise<void> {
    if (!this.dir.exists) return;
    for (const entry of this.dir.list()) {
      if (entry instanceof File) entry.delete();
    }
  }
}
