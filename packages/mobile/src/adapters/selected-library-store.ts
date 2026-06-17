import type { Library } from "@musex/core";
import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "musex.selected-library";

/** The last library the user selected, or null if none/corrupt. Never throws. */
export async function loadSelectedLibrary(): Promise<Library | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Library) : null;
  } catch (err) {
    console.warn("[library] load failed", err);
    return null;
  }
}

export async function saveSelectedLibrary(library: Library): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(library));
  } catch (err) {
    console.warn("[library] save failed", err);
  }
}

export async function clearSelectedLibrary(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch (err) {
    console.warn("[library] clear failed", err);
  }
}
