import { describe, expect, it } from "vitest";
import { artUrl } from "./art-url";

describe("artUrl", () => {
  it("builds a tokenized Plex art URL from a thumb path", () => {
    expect(artUrl("https://pms.example:32400", "/library/metadata/10/thumb/123", "TOK")).toBe(
      "https://pms.example:32400/library/metadata/10/thumb/123?X-Plex-Token=TOK",
    );
  });
  it("returns null when thumb is missing", () => {
    expect(artUrl("https://pms.example:32400", undefined, "TOK")).toBeNull();
    expect(artUrl("https://pms.example:32400", "", "TOK")).toBeNull();
  });
  it("encodes the token", () => {
    expect(artUrl("https://b", "/t", "a b")).toBe("https://b/t?X-Plex-Token=a%20b");
  });
});
