import { describe, expect, it, vi } from "vitest";
import { SecureTokenStore } from "./token-store";

// Self-contained in-memory mock (Map lives inside the factory) so it doesn't
// trip vitest's hoisting restriction on referencing outer variables.
vi.mock("expo-secure-store", () => {
  const store = new Map<string, string>();
  return {
    setItemAsync: async (k: string, v: string) => {
      store.set(k, v);
    },
    getItemAsync: async (k: string) => store.get(k) ?? null,
    deleteItemAsync: async (k: string) => {
      store.delete(k);
    },
  };
});

describe("SecureTokenStore", () => {
  it("saves, loads, and clears the token", async () => {
    const ts = new SecureTokenStore();
    expect(await ts.load()).toBeNull();
    await ts.save("TOK");
    expect(await ts.load()).toBe("TOK");
    await ts.clear();
    expect(await ts.load()).toBeNull();
  });
});
