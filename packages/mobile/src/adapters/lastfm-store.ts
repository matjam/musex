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

// AFTER_FIRST_UNLOCK: keep the items readable while the device is locked (iOS
// relaunches the app in the background for URLSession events; the default
// WHEN_UNLOCKED rejects Keychain reads there). Accessibility is an attribute
// of the stored item, applied at WRITE time — see token-store.ts.
const KEYCHAIN_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
};

/** Rewrite a just-read item so pre-existing WHEN_UNLOCKED entries upgrade to
 *  AFTER_FIRST_UNLOCK (accessibility only changes on rewrite). */
function rewriteForAccessibility(key: string, value: string): void {
  void SecureStore.setItemAsync(key, value, KEYCHAIN_OPTIONS).catch((err) => {
    console.warn("[lastfm] keychain accessibility rewrite failed", err);
  });
}

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
  const secret = await SecureStore.getItemAsync(SECRET_KEY, KEYCHAIN_OPTIONS);
  if (secret !== null) rewriteForAccessibility(SECRET_KEY, secret);
  return secret;
}
export async function saveSecret(secret: string): Promise<void> {
  await SecureStore.setItemAsync(SECRET_KEY, secret, KEYCHAIN_OPTIONS);
}
export async function loadSessionKey(): Promise<string | null> {
  const sk = await SecureStore.getItemAsync(SESSION_KEY, KEYCHAIN_OPTIONS);
  if (sk !== null) rewriteForAccessibility(SESSION_KEY, sk);
  return sk;
}
export async function saveSessionKey(sk: string): Promise<void> {
  await SecureStore.setItemAsync(SESSION_KEY, sk, KEYCHAIN_OPTIONS);
}
export async function clearSession(): Promise<void> {
  await SecureStore.deleteItemAsync(SESSION_KEY, KEYCHAIN_OPTIONS);
}
