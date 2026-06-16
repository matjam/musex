/** First-letter bucket for an A–Z index. A–Z map to themselves (uppercased);
 *  digits, symbols, accented/non-ASCII, and empty all bucket under "#".
 *  (Plex sorts accents under their base letter; v1 buckets them under # — a
 *  known minor mismatch, acceptable until we normalize.) */
export function letterFor(name: string): string {
  const c = (name.trim()[0] ?? "").toUpperCase();
  return c >= "A" && c <= "Z" ? c : "#";
}

const ORDER = ["#", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"];

/** Given an ALREADY ALPHABETICALLY-SORTED list, returns the present letters (in
 *  #,A..Z order) and the first index of each — for FlatList scrollToIndex. */
export function buildLetterIndex<T>(
  items: T[],
  keyFn: (t: T) => string,
): { letters: string[]; indexOf: Record<string, number> } {
  const indexOf: Record<string, number> = {};
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item === undefined) continue;
    const l = letterFor(keyFn(item));
    if (!(l in indexOf)) indexOf[l] = i;
  }
  const letters = ORDER.filter((l) => l in indexOf);
  return { letters, indexOf };
}
