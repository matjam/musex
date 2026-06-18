import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";

export interface LastfmConfig {
  apiKey: string;
  scrobbling: boolean;
  loveOnRating: boolean;
  username: string | null;
  connection: string;
}

const CONFIG_KEY = "musex.lastfm";
const SECRET_KEY = "lastfm-secret";
const SESSION_KEY = "lastfm-session";

export const DEFAULT_LASTFM_CONFIG: LastfmConfig = {
  apiKey: "",
  scrobbling: true,
  loveOnRating: true,
  username: null,
  connection: "Not connected",
};

export async function loadLastfmConfig(): Promise<LastfmConfig> {
  try {
    const raw = await AsyncStorage.getItem(CONFIG_KEY);
    return raw
      ? { ...DEFAULT_LASTFM_CONFIG, ...(JSON.parse(raw) as Partial<LastfmConfig>) }
      : DEFAULT_LASTFM_CONFIG;
  } catch {
    return DEFAULT_LASTFM_CONFIG;
  }
}

export async function saveLastfmConfig(cfg: LastfmConfig): Promise<void> {
  try {
    await AsyncStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
  } catch (err) {
    console.warn("[lastfm] config save failed", err);
  }
}

export async function loadSecret(): Promise<string | null> {
  return SecureStore.getItemAsync(SECRET_KEY);
}
export async function saveSecret(secret: string): Promise<void> {
  await SecureStore.setItemAsync(SECRET_KEY, secret);
}
export async function loadSessionKey(): Promise<string | null> {
  return SecureStore.getItemAsync(SESSION_KEY);
}
export async function saveSessionKey(sk: string): Promise<void> {
  await SecureStore.setItemAsync(SESSION_KEY, sk);
}
export async function clearSession(): Promise<void> {
  await SecureStore.deleteItemAsync(SESSION_KEY);
}
