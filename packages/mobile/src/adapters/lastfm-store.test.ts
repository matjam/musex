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
    AFTER_FIRST_UNLOCK: 1002,
    getItemAsync: vi.fn(async (k: string, _o?: unknown) => m.get(k) ?? null),
    setItemAsync: vi.fn(async (k: string, v: string, _o?: unknown) => void m.set(k, v)),
    deleteItemAsync: vi.fn(async (k: string, _o?: unknown) => void m.delete(k)),
  };
});

import * as SecureStore from "expo-secure-store";
import {
  clearSession,
  DEFAULT_LASTFM_CONFIG,
  loadLastfmConfig,
  loadSecret,
  loadSessionKey,
  saveLastfmConfig,
  saveSecret,
  saveSessionKey,
} from "./lastfm-store";

const setItemAsync = vi.mocked(SecureStore.setItemAsync);

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
  it("writes secrets with AFTER_FIRST_UNLOCK accessibility", async () => {
    await saveSecret("sssh");
    expect(setItemAsync).toHaveBeenCalledWith("lastfm-secret", "sssh", {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
    });
    await saveSessionKey("sk");
    expect(setItemAsync).toHaveBeenCalledWith("lastfm-session", "sk", {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
    });
  });
  it("rewrites secret and session key on successful load (accessibility migration)", async () => {
    await saveSecret("sssh");
    await saveSessionKey("sk");
    setItemAsync.mockClear();
    expect(await loadSecret()).toBe("sssh");
    expect(setItemAsync).toHaveBeenCalledWith("lastfm-secret", "sssh", {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
    });
    expect(await loadSessionKey()).toBe("sk");
    expect(setItemAsync).toHaveBeenCalledWith("lastfm-session", "sk", {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
    });
    // No rewrite when nothing is stored.
    await clearSession();
    setItemAsync.mockClear();
    expect(await loadSessionKey()).toBeNull();
    expect(setItemAsync).not.toHaveBeenCalled();
  });
});
