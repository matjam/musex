import { safeStorage as electronSafeStorage } from "electron";

/** The slice of Electron safeStorage we use — injectable for tests. */
export interface SecureBackend {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(buf: Buffer): string;
}

const PLAINTEXT_TAG = "musex-plaintext:v1:";

/** Encrypt `plain` to a Buffer. When the OS keyring is unavailable (common on
 *  minimal Linux environments without gnome-keyring/kwallet) we fall back to
 *  TAGGED plaintext so the app stays usable — a deliberate, surfaced downgrade
 *  (the Plex token is revocable and self-hosted). The tag lets decrypt tell the
 *  two apart; real safeStorage ciphertext never starts with it.
 *
 *  Uses the sync safeStorage methods (encryptString/decryptString) — tokens and
 *  plugin secrets are tiny and infrequent, keeping the helper simple. */
export function secureEncrypt(plain: string, backend: SecureBackend = electronSafeStorage): Buffer {
  if (backend.isEncryptionAvailable()) return backend.encryptString(plain);
  return Buffer.from(PLAINTEXT_TAG + plain, "utf8");
}

/** Inverse of secureEncrypt. Returns null for empty input. */
export function secureDecrypt(
  buf: Buffer,
  backend: SecureBackend = electronSafeStorage,
): string | null {
  if (buf.length === 0) return null;
  const asText = buf.toString("utf8");
  if (asText.startsWith(PLAINTEXT_TAG)) return asText.slice(PLAINTEXT_TAG.length);
  return backend.decryptString(buf);
}

/** Whether real OS encryption is in effect (false → plaintext fallback active). */
export function isSecureStorageAvailable(backend: SecureBackend = electronSafeStorage): boolean {
  return backend.isEncryptionAvailable();
}
