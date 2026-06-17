import AsyncStorage from "@react-native-async-storage/async-storage";
import type { TasteState } from "@musex/core";

const KEY = "musex.listening-profile";

/** Load the persisted listening profile, or null if absent/corrupt. Never
 *  throws — a read failure starts the user fresh rather than breaking launch. */
export async function loadTasteState(): Promise<TasteState | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as TasteState) : null;
  } catch (err) {
    console.warn("[taste] load failed", err);
    return null;
  }
}

/** Persist the listening profile. Never throws — a write failure is logged and
 *  dropped (the next debounced save retries). */
export async function saveTasteState(state: TasteState): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(state));
  } catch (err) {
    console.warn("[taste] save failed", err);
  }
}
