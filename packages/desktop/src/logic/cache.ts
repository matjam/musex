import { createHash } from "node:crypto";

/** Stable cache key for a media file: sha256 of serverId + Plex path.
 *  The Plex part path embeds a file-version token, so a changed file yields a
 *  new key (the stale entry is later evicted). */
export function cacheKey(serverId: string, plexPath: string): string {
  return createHash("sha256").update(`${serverId}:${plexPath}`).digest("hex");
}

/** Only original media files under /library/parts/ are cached. This excludes
 *  artwork (/library/metadata/.../thumb) and transcode streams (/music/:/transcode). */
export function isCacheablePath(plexPath: string): boolean {
  return plexPath.startsWith("/library/parts/");
}

const CONTENT_TYPES: Record<string, string> = {
  flac: "audio/flac",
  mp3: "audio/mpeg",
  mp2: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/mp4",
  ogg: "audio/ogg",
  opus: "audio/ogg",
  wav: "audio/wav",
  wave: "audio/wav",
};

/** Content-Type from a file path's extension (for serving cache hits). */
export function contentTypeForPath(plexPath: string): string {
  const dot = plexPath.lastIndexOf(".");
  const ext = dot === -1 ? "" : plexPath.slice(dot + 1).toLowerCase();
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

export interface ByteRange {
  start: number;
  end: number;
}

/** Parse a single `bytes=start-end` Range header against a known size.
 *  Returns null for absent/unsupported/unsatisfiable ranges (caller serves full). */
export function parseByteRange(header: string | undefined, size: number): ByteRange | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  const startStr = m[1] ?? "";
  const endStr = m[2] ?? "";
  if (startStr === "" && endStr === "") return null;
  let start: number;
  let end: number;
  if (startStr === "") {
    const n = Number(endStr); // suffix range: last N bytes
    if (!Number.isFinite(n) || n <= 0) return null;
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(startStr);
    end = endStr === "" ? size - 1 : Number(endStr);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start > end || start >= size) return null;
  if (end >= size) end = size - 1;
  return { start, end };
}

/** Plex artwork/image paths (album/artist/track thumbs, background art, resized photos). */
export function isArtPath(plexPath: string): boolean {
  return (
    plexPath.includes("/thumb/") || plexPath.includes("/art/") || plexPath.startsWith("/photo/")
  );
}

/** Best-effort image MIME from a file's leading bytes (art URLs carry no extension). */
export function sniffImageType(head: Uint8Array): string {
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47)
    return "image/png";
  if (head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x38)
    return "image/gif";
  if (
    head[0] === 0x52 &&
    head[1] === 0x49 &&
    head[2] === 0x46 &&
    head[3] === 0x46 &&
    head[8] === 0x57 &&
    head[9] === 0x45 &&
    head[10] === 0x42 &&
    head[11] === 0x50
  ) {
    return "image/webp";
  }
  return "application/octet-stream";
}

export interface CacheEntryMeta {
  name: string;
  size: number;
  mtimeMs: number;
}

/** Given current cache entries and a byte cap, return the names to delete
 *  (least-recently-modified first) so the total falls within the cap. */
export function selectEvictions(entries: CacheEntryMeta[], maxBytes: number): string[] {
  let total = 0;
  for (const e of entries) total += e.size;
  if (total <= maxBytes) return [];
  const byOldest = [...entries].sort((a, b) => a.mtimeMs - b.mtimeMs);
  const toDelete: string[] = [];
  for (const e of byOldest) {
    if (total <= maxBytes) break;
    toDelete.push(e.name);
    total -= e.size;
  }
  return toDelete;
}
