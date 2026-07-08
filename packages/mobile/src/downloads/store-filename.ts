/** Map a download key to a FLAT, reversible on-disk filename.
 *
 *  A download key is `downloadKey(serverId, plexPath)` = `serverId␟<plexPath>`,
 *  and the Plex part path contains `/` (e.g. `/library/parts/9/171.../file.flac`).
 *  expo-file-system's `new File(dir, name)` joins the name via
 *  `URL.appendingPathComponent` natively, so a raw key's slashes become real
 *  directory components. Those parent directories don't exist, and `File.create`
 *  / the download-task move don't create intermediates — so every write targets a
 *  missing nested path and silently fails, leaving the device empty. (Desktop
 *  avoids this by hashing the key to 64-hex; mobile never flattened it.)
 *
 *  `encodeURIComponent` removes every `/` (→ `%2F`) — and `␟`, spaces, etc. — so
 *  the result is a single flat filename, while staying reversible so reconcile can
 *  recover the key from a directory listing. `.` is left intact, so the file
 *  extension survives and the `.part` temp-suffix convention still works.
 *
 *  (Absorbed from PR #102, which found the root cause of downloads never
 *  persisting on device.) */
export function storeFileName(key: string): string {
  return encodeURIComponent(key);
}

/** Inverse of {@link storeFileName}: recover the download key from an on-disk
 *  filename (used by reconcile, which lists the directory). */
export function keyForFileName(fileName: string): string {
  return decodeURIComponent(fileName);
}
