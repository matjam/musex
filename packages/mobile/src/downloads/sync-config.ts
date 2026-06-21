import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "musex.library-sync";

/** Whether "sync entire library to this device" is on. Persisted per device. */
export async function loadSyncEnabled(): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return false;
    const obj = JSON.parse(raw) as { enabled?: unknown };
    return obj.enabled === true;
  } catch {
    return false;
  }
}

export async function saveSyncEnabled(enabled: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify({ enabled }));
  } catch (err) {
    console.warn("[sync] persist failed", err);
  }
}
