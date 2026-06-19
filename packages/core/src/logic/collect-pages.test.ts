import { describe, expect, it, vi } from "vitest";
import { collectPages } from "./collect-pages";

/** Build a fake paged endpoint over a fixed array. */
function pagedOver<T>(
  data: T[],
): (start: number, size: number) => Promise<{ items: T[]; total: number }> {
  return async (start, size) => ({ items: data.slice(start, start + size), total: data.length });
}

describe("collectPages", () => {
  it("walks every page and concatenates in order", async () => {
    const data = Array.from({ length: 2500 }, (_, i) => i);
    const fetchPage = vi.fn(pagedOver(data));
    const all = await collectPages(1000, fetchPage);
    expect(all).toEqual(data);
    expect(fetchPage).toHaveBeenCalledTimes(3); // 1000 + 1000 + 500
  });

  it("handles an exact multiple of the page size (stops on count >= total)", async () => {
    const data = Array.from({ length: 2000 }, (_, i) => i);
    const fetchPage = vi.fn(pagedOver(data));
    const all = await collectPages(1000, fetchPage);
    expect(all).toHaveLength(2000);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it("returns empty for an empty library without looping", async () => {
    const fetchPage = vi.fn(pagedOver<number>([]));
    expect(await collectPages(1000, fetchPage)).toEqual([]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it("stops on an empty page even if total is overstated (no infinite loop)", async () => {
    // total claims 1000 but only 10 items exist → page 2 is empty → stop.
    let call = 0;
    const fetchPage = vi.fn(async (start: number, size: number) => {
      call++;
      return call === 1
        ? { items: Array.from({ length: 10 }, (_, i) => i), total: 1000 }
        : { items: [], total: 1000 };
    });
    const all = await collectPages(500, fetchPage);
    expect(all).toHaveLength(10);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });
});
