import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { TokenStore } from "@musex/core";
import { app } from "electron";
import { secureDecrypt, secureEncrypt } from "./secure-store.js";

/** Persists the Plex token encrypted via the OS keychain when available.
 *  On systems without a keyring (e.g. minimal Linux without gnome-keyring or
 *  kwallet) the token is stored as tagged plaintext — a deliberate, surfaced
 *  downgrade. The Settings → General pane warns the user when that fallback is
 *  active. safeStorage handles encryption/decryption; we persist the bytes to
 *  userData ourselves. */
export class SafeStorageTokenStore implements TokenStore {
  private readonly file = join(app.getPath("userData"), "plex-token.enc");

  async save(token: string): Promise<void> {
    const buf = secureEncrypt(token);
    writeFileSync(this.file, buf);
  }

  async load(): Promise<string | null> {
    if (!existsSync(this.file)) return null;
    const buf = readFileSync(this.file);
    return secureDecrypt(buf);
  }

  async clear(): Promise<void> {
    if (existsSync(this.file)) rmSync(this.file);
  }
}
