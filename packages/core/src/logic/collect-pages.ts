/** Accumulate every item from a paged endpoint into one array.
 *
 *  Calls `fetchPage(start, pageSize)` from offset 0, appending each page's
 *  `items` and advancing by however many came back, until the accumulated count
 *  reaches the reported `total` or a page comes back empty (the empty-page guard
 *  prevents an infinite loop if `total` is wrong or the library shrinks mid-walk).
 *  Used to fetch a whole large library in bounded requests instead of one giant
 *  one that times out. */
export async function collectPages<T>(
  pageSize: number,
  fetchPage: (start: number, size: number) => Promise<{ items: T[]; total: number }>,
): Promise<T[]> {
  const all: T[] = [];
  let start = 0;
  for (;;) {
    const { items, total } = await fetchPage(start, pageSize);
    all.push(...items);
    start += items.length;
    if (items.length === 0 || all.length >= total) break;
  }
  return all;
}
