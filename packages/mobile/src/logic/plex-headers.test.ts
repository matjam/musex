import { describe, expect, it } from "vitest";
import { plexHeaders } from "./plex-headers";

describe("plexHeaders", () => {
  it("includes the client identifier and product headers", () => {
    const h = plexHeaders("abc-123");
    expect(h["X-Plex-Client-Identifier"]).toBe("abc-123");
    expect(h["X-Plex-Product"]).toBe("musex");
    expect(h.Accept).toBe("application/json");
  });

  it("merges and overrides with extra headers", () => {
    const h = plexHeaders("id", { "X-Plex-Token": "tok" });
    expect(h["X-Plex-Token"]).toBe("tok");
    expect(h["X-Plex-Client-Identifier"]).toBe("id");
  });
});
