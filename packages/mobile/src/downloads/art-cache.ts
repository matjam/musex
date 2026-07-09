/** Offline album-art cache for downloaded content: one `<albumId>.jpg` per
 *  album under `art-cache/` in the app document directory, fetched when a
 *  download completes (and via a bootstrap catch-up pass) so downloaded albums
 *  render art with no network.
 *
 *  Known-and-accepted: removing a single album's DOWNLOADS may leave its art
 *  file behind — bounded (one small jpg per ever-downloaded album), and
 *  "Remove all downloads" clears the whole cache.
 */

/** Filesystem seam (fake-able in tests — the real impl is `ExpoArtFs` in
 *  art-cache-fs.ts, which pulls in the native expo-file-system module). */
export interface ArtFs {
  exists(name: string): boolean;
  uri(name: string): string;
  write(name: string, bytes: Uint8Array): void;
  remove(name: string): void;
  removeAll(): void;
}

/** Minimal fetch shape (global fetch satisfies it; tests inject a fake). */
export type ArtFetch = (url: string) => Promise<{
  ok: boolean;
  status: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

/** Album ids are plain numeric Plex ratingKeys, but they arrive from persisted
 *  records — sanitize so an unexpected id can never traverse paths. */
export function artFileName(albumId: string): string {
  return `${albumId.replace(/[^A-Za-z0-9._-]/g, "_")}.jpg`;
}

export class ArtCache {
  constructor(
    private readonly fs: ArtFs,
    private readonly fetchFn: ArtFetch,
  ) {}

  has(albumId: string): boolean {
    return this.fs.exists(artFileName(albumId));
  }

  /** file:// uri of the cached art, or null when not cached. */
  uri(albumId: string): string | null {
    const name = artFileName(albumId);
    return this.fs.exists(name) ? this.fs.uri(name) : null;
  }

  /** Download + store the album's art. No-op when already cached. Failures are
   *  logged, never thrown — art is best-effort; a miss just means the tile
   *  falls back to the network URL (or the placeholder offline). */
  async fetchIfMissing(albumId: string, url: string): Promise<void> {
    const name = artFileName(albumId);
    if (this.fs.exists(name)) return;
    try {
      const res = await this.fetchFn(url);
      if (!res.ok) {
        console.warn(`[art-cache] fetch failed for album ${albumId}: http ${res.status}`);
        return;
      }
      this.fs.write(name, new Uint8Array(await res.arrayBuffer()));
    } catch (err) {
      console.warn(`[art-cache] fetch failed for album ${albumId}`, err);
    }
  }

  remove(albumId: string): void {
    this.fs.remove(artFileName(albumId));
  }

  clear(): void {
    this.fs.removeAll();
  }
}
