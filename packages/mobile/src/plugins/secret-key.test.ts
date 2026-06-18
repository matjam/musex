import { sha256 } from "js-sha256";
import { describe, expect, it } from "vitest";
import { secretStoreKey } from "./secret-key.js";

const hash = (s: string) => sha256(s);

describe("secretStoreKey", () => {
  it("is SecureStore-legal ([A-Za-z0-9._-] only)", () => {
    const key = secretStoreKey("musex.plugin-secret:lidarr:api:key", hash);
    expect(key).toMatch(/^[A-Za-z0-9._-]+$/);
  });

  it("is stable for the same input", () => {
    const a = secretStoreKey("musex.plugin-secret:lidarr:token", hash);
    const b = secretStoreKey("musex.plugin-secret:lidarr:token", hash);
    expect(a).toBe(b);
  });

  it("distinguishes keys that the old lossy sanitizer collapsed (':' vs '_')", () => {
    // Old behavior: both x:y and x_y -> "...x_y" (collision). sha256 must split them.
    const colon = secretStoreKey("musex.plugin-secret:p:x:y", hash);
    const underscore = secretStoreKey("musex.plugin-secret:p:x_y", hash);
    expect(colon).not.toBe(underscore);
  });

  it("distinguishes different plugins for the same inner key", () => {
    const a = secretStoreKey("musex.plugin-secret:pluginA:token", hash);
    const b = secretStoreKey("musex.plugin-secret:pluginB:token", hash);
    expect(a).not.toBe(b);
  });

  it("distinguishes different inner keys for the same plugin", () => {
    const a = secretStoreKey("musex.plugin-secret:p:k1", hash);
    const b = secretStoreKey("musex.plugin-secret:p:k2", hash);
    expect(a).not.toBe(b);
  });
});
