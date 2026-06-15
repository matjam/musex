import { describe, expect, it } from "vitest";
import { plexSort } from "./library-sort";

describe("plexSort", () => {
  it('maps "title" to titleSort', () => {
    expect(plexSort("title")).toBe("titleSort");
  });

  it('maps "artist" to artist.titleSort', () => {
    expect(plexSort("artist")).toBe("artist.titleSort");
  });

  it('maps "added" to addedAt:desc', () => {
    expect(plexSort("added")).toBe("addedAt:desc");
  });
});
