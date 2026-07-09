import { Directory, File, Paths } from "expo-file-system";
import type { ArtFs } from "./art-cache";

/** The real `ArtFs` over the SDK-56 expo-file-system `File`/`Directory`/`Paths`
 *  API, under `art-cache/` in the app document directory. NOT imported by the
 *  unit test (it pulls in the native module — same split as ExpoListCacheFs). */
export class ExpoArtFs implements ArtFs {
  private readonly dir = new Directory(Paths.document, "art-cache");

  exists(name: string): boolean {
    return new File(this.dir, name).exists;
  }

  uri(name: string): string {
    return new File(this.dir, name).uri;
  }

  write(name: string, bytes: Uint8Array): void {
    if (!this.dir.exists) this.dir.create();
    const f = new File(this.dir, name);
    if (!f.exists) f.create();
    f.write(bytes);
  }

  remove(name: string): void {
    const f = new File(this.dir, name);
    if (f.exists) f.delete();
  }

  removeAll(): void {
    if (!this.dir.exists) return;
    for (const entry of this.dir.list()) {
      if (entry instanceof File) entry.delete();
    }
  }
}
