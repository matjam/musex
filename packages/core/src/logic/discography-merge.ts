/** Merge "what can be fetched" (acquisition providers — authoritative
 *  per-album state) with "what exists in the world" (similar-provider top
 *  albums, e.g. last.fm). Titles only last.fm knows are appended as
 *  unavailable: visible, but not monitorable — if it's not on the
 *  acquisition side, it's not fetchable. */

interface AcquirableLike {
  providerId: string;
  providerRef: string;
  artistName: string;
  title: string;
  state: string;
  [key: string]: unknown;
}

export function mergeDiscography<T extends AcquirableLike>(
  artistName: string,
  acquirable: T[],
  knownTitles: { title: string }[],
): (T | AcquirableLike)[] {
  const have = new Set(acquirable.map((a) => a.title.trim().toLowerCase()));
  const out: (T | AcquirableLike)[] = [...acquirable];
  for (const k of knownTitles) {
    const key = k.title.trim().toLowerCase();
    if (key === "" || have.has(key)) continue;
    have.add(key); // dedupe within knownTitles too
    out.push({
      providerId: "external",
      providerRef: `title:${key}`,
      artistName,
      title: k.title,
      state: "unavailable",
    });
  }
  return out;
}
