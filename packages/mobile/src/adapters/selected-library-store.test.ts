import type { Library } from "@musex/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
import {
  clearSelectedLibrary,
  loadSelectedLibrary,
  saveSelectedLibrary,
} from "./selected-library-store";

const lib: Library = {
  id: "3",
  serverId: "s",
  serverName: "Mine",
  title: "Music",
  type: "music",
  owned: true,
};

describe("selected-library-store", () => {
  beforeEach(() => {
    (AsyncStorage as unknown as { __store: Map<string, string> }).__store.clear();
  });
  it("round-trips a library", async () => {
    expect(await loadSelectedLibrary()).toBeNull();
    await saveSelectedLibrary(lib);
    expect(await loadSelectedLibrary()).toEqual(lib);
  });
  it("clears", async () => {
    await saveSelectedLibrary(lib);
    await clearSelectedLibrary();
    expect(await loadSelectedLibrary()).toBeNull();
  });
  it("returns null on malformed JSON", async () => {
    await AsyncStorage.setItem("musex.selected-library", "{bad");
    expect(await loadSelectedLibrary()).toBeNull();
  });
});
