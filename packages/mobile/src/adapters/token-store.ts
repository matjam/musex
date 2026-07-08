import type { TokenStore } from "@musex/core";
import * as SecureStore from "expo-secure-store";

const KEY = "plex-token";

// AFTER_FIRST_UNLOCK: the item stays readable while the device is LOCKED (any
// time after the first unlock since boot). iOS relaunches the app in the
// background for URLSession events while locked; the default WHEN_UNLOCKED
// accessibility rejects Keychain reads there (errSecInteractionNotAllowed),
// which wedged bootstrap in an eternal "loading" phase. Accessibility is an
// attribute of the stored item, applied at WRITE time.
const KEYCHAIN_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
};

/** TokenStore backed by the iOS Keychain via expo-secure-store. */
export class SecureTokenStore implements TokenStore {
  async save(token: string): Promise<void> {
    await SecureStore.setItemAsync(KEY, token, KEYCHAIN_OPTIONS);
  }
  async load(): Promise<string | null> {
    const token = await SecureStore.getItemAsync(KEY, KEYCHAIN_OPTIONS);
    // Migration: accessibility only changes when the item is REWRITTEN, so an
    // item stored before KEYCHAIN_OPTIONS existed keeps WHEN_UNLOCKED until we
    // rewrite it. Fire-and-forget a rewrite on every successful (i.e.
    // unlocked) load so existing installs upgrade to AFTER_FIRST_UNLOCK.
    if (token !== null) {
      void this.save(token).catch((err) => {
        console.warn("[token-store] keychain accessibility rewrite failed", err);
      });
    }
    return token;
  }
  async clear(): Promise<void> {
    await SecureStore.deleteItemAsync(KEY, KEYCHAIN_OPTIONS);
  }
}
