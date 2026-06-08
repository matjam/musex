import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { TokenStore } from "@musex/core";
import { app, safeStorage } from "electron";

/** Persists the Plex token encrypted via the OS keychain (macOS Keychain).
 *  safeStorage only encrypts/decrypts — we persist the ciphertext to userData. */
export class SafeStorageTokenStore implements TokenStore {
  private readonly file = join(app.getPath("userData"), "plex-token.enc");

  async save(token: string): Promise<void> {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("OS secure storage is unavailable; cannot persist Plex token");
    }
    const buf = await safeStorage.encryptStringAsync(token);
    writeFileSync(this.file, buf);
  }

  async load(): Promise<string | null> {
    if (!existsSync(this.file) || !safeStorage.isEncryptionAvailable()) return null;
    const buf = readFileSync(this.file);
    const { result } = await safeStorage.decryptStringAsync(buf);
    return result;
  }

  async clear(): Promise<void> {
    if (existsSync(this.file)) rmSync(this.file);
  }
}
