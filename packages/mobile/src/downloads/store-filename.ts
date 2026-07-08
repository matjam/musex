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

/** RESERVED marker suffix (like `.part`/`.orig`) for on-device CONVERTED
 *  artifacts: `<flat>.conv.m4a`. AVPlayer infers a local file's format from
 *  its EXTENSION — an AAC m4a committed under the bare flat name (which ends
 *  with the SOURCE extension, e.g. `….flac`) refuses to play, the mirror
 *  image of the fixed bare-`.orig` "Cannot Open". The `.conv` marker keeps
 *  the name unambiguous vs an original whose own flat name ends `.m4a`. */
export const CONVERTED_SUFFIX = ".conv.m4a";

/** The on-disk filename of a key's CONVERTED artifact. */
export function convertedFileName(key: string): string {
  return storeFileName(key) + CONVERTED_SUFFIX;
}

/** Whether a directory-listing name is a converted artifact. */
export function isConvertedFileName(fileName: string): boolean {
  return fileName.endsWith(CONVERTED_SUFFIX);
}

/** Recover the download key from ANY committed on-disk name: a converted
 *  `<flat>.conv.m4a` strips the reserved suffix first; a bare flat name
 *  decodes directly. (The suffix is plain ASCII, untouched by the encoding,
 *  so stripping before decoding is exact.) */
export function keyForDiskName(fileName: string): string {
  return keyForFileName(
    isConvertedFileName(fileName) ? fileName.slice(0, -CONVERTED_SUFFIX.length) : fileName,
  );
}
