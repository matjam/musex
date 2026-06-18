import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@react-native-async-storage/async-storage", () => {
  const m = new Map<string, string>();
  return {
    default: {
      getItem: async (k: string) => m.get(k) ?? null,
      setItem: async (k: string, v: string) => void m.set(k, v),
    },
  };
});
vi.mock("expo-secure-store", () => {
  const m = new Map<string, string>();
  return {
    getItemAsync: async (k: string) => m.get(k) ?? null,
    setItemAsync: async (k: string, v: string) => void m.set(k, v),
    deleteItemAsync: async (k: string) => void m.delete(k),
  };
});

import {
  DEFAULT_LASTFM_CONFIG,
  loadLastfmConfig,
  loadSecret,
  saveLastfmConfig,
  saveSecret,
} from "./lastfm-store";

describe("lastfm-store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("round-trips config with default merge", async () => {
    await saveLastfmConfig({ ...DEFAULT_LASTFM_CONFIG, apiKey: "K", scrobbling: false });
    const cfg = await loadLastfmConfig();
    expect(cfg.apiKey).toBe("K");
    expect(cfg.scrobbling).toBe(false);
    expect(cfg.loveOnRating).toBe(true); // default preserved
  });
  it("round-trips the secret via secure-store", async () => {
    await saveSecret("sssh");
    expect(await loadSecret()).toBe("sssh");
  });
});
