import { beforeEach, describe, expect, it, vi } from "vitest";

// Self-contained in-memory mock (state lives inside the factory) so it doesn't
// trip vitest's hoisting restriction on referencing outer variables.
vi.mock("expo-secure-store", () => {
  const store = new Map<string, string>();
  return {
    AFTER_FIRST_UNLOCK: 1002,
    setItemAsync: vi.fn(async (k: string, v: string, _o?: unknown) => {
      store.set(k, v);
    }),
    getItemAsync: vi.fn(async (k: string, _o?: unknown) => store.get(k) ?? null),
    deleteItemAsync: vi.fn(async (k: string, _o?: unknown) => {
      store.delete(k);
    }),
  };
});

import * as SecureStore from "expo-secure-store";
import { SecureTokenStore } from "./token-store";

const setItemAsync = vi.mocked(SecureStore.setItemAsync);
const getItemAsync = vi.mocked(SecureStore.getItemAsync);
const deleteItemAsync = vi.mocked(SecureStore.deleteItemAsync);

describe("SecureTokenStore", () => {
  beforeEach(() => {
    setItemAsync.mockClear();
    getItemAsync.mockClear();
    deleteItemAsync.mockClear();
  });

  it("saves, loads, and clears the token", async () => {
    const ts = new SecureTokenStore();
    expect(await ts.load()).toBeNull();
    await ts.save("TOK");
    expect(await ts.load()).toBe("TOK");
    await ts.clear();
    expect(await ts.load()).toBeNull();
  });

  it("writes with AFTER_FIRST_UNLOCK accessibility (readable while locked)", async () => {
    const ts = new SecureTokenStore();
    await ts.save("TOK");
    expect(setItemAsync).toHaveBeenCalledWith("plex-token", "TOK", {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
    });
  });

  it("rewrites the item on a successful load (accessibility migration)", async () => {
    const ts = new SecureTokenStore();
    await ts.save("TOK");
    setItemAsync.mockClear();
    expect(await ts.load()).toBe("TOK");
    // The migration rewrite is fire-and-forget but starts synchronously.
    expect(setItemAsync).toHaveBeenCalledWith("plex-token", "TOK", {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
    });
  });

  it("does not rewrite when there is no stored token", async () => {
    const ts = new SecureTokenStore();
    await ts.clear(); // the mock's backing Map persists across tests in this file
    setItemAsync.mockClear();
    expect(await ts.load()).toBeNull();
    expect(setItemAsync).not.toHaveBeenCalled();
  });
});
