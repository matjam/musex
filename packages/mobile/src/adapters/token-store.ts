import type { TokenStore } from "@musex/core";
import * as SecureStore from "expo-secure-store";

const KEY = "plex-token";

/** TokenStore backed by the iOS Keychain via expo-secure-store. */
export class SecureTokenStore implements TokenStore {
  async save(token: string): Promise<void> {
    await SecureStore.setItemAsync(KEY, token);
  }
  async load(): Promise<string | null> {
    return SecureStore.getItemAsync(KEY);
  }
  async clear(): Promise<void> {
    await SecureStore.deleteItemAsync(KEY);
  }
}
