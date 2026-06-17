import type { TasteState } from "@musex/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Keep the backing store INSIDE the factory (vitest hoists vi.mock above imports).
vi.mock("@react-native-async-storage/async-storage", () => {
  const store = new Map<string, string>();
  return {
    default: {
      getItem: async (k: string) => store.get(k) ?? null,
      setItem: async (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: async (k: string) => {
        store.delete(k);
      },
      __store: store,
    },
  };
});

import AsyncStorage from "@react-native-async-storage/async-storage";
import { loadTasteState, saveTasteState } from "./taste-persistence";

const sample: TasteState = {
  artists: {
    lamb: { name: "Lamb", score: 3, plays: 5, skips: 0, lastSeenMs: 1, artistRatingStars: null },
  },
  tracks: {},
};

describe("taste-persistence", () => {
  beforeEach(() => {
    (AsyncStorage as unknown as { __store: Map<string, string> }).__store.clear();
  });

  it("round-trips a TasteState", async () => {
    expect(await loadTasteState()).toBeNull();
    await saveTasteState(sample);
    expect(await loadTasteState()).toEqual(sample);
  });

  it("returns null on malformed JSON instead of throwing", async () => {
    await AsyncStorage.setItem("musex.listening-profile", "{not json");
    expect(await loadTasteState()).toBeNull();
  });
});
