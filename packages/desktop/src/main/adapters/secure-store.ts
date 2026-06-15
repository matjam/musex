/** The slice of Electron safeStorage we use — injectable for tests. */
export interface SecureBackend {
  isEncryptionAvailable(): boolean;
  encryptStringAsync(plain: string): Promise<Buffer>;
  decryptStringAsync(buf: Buffer): Promise<{ result: string; shouldReEncrypt: boolean }>;
}

const PLAINTEXT_TAG = "musex-plaintext:v1:";

/** Encrypt `plain` to a Buffer. When the OS keyring is unavailable (common on
 *  minimal Linux environments without gnome-keyring/kwallet) we fall back to
 *  TAGGED plaintext so the app stays usable — a deliberate, surfaced downgrade
 *  (the Plex token is revocable and self-hosted). The tag lets decrypt tell the
 *  two apart; real safeStorage ciphertext never starts with it. */
export async function secureEncrypt(plain: string, backend: SecureBackend): Promise<Buffer> {
  if (backend.isEncryptionAvailable()) return backend.encryptStringAsync(plain);
  return Buffer.from(PLAINTEXT_TAG + plain, "utf8");
}

/** Inverse of secureEncrypt. Returns null for empty input, and surfaces whether
 *  the OS signaled the ciphertext should be re-encrypted with a rotated key.
 *  Tagged plaintext and empty inputs never need re-encryption. */
export async function secureDecrypt(
  buf: Buffer,
  backend: SecureBackend,
): Promise<{ value: string | null; shouldReEncrypt: boolean }> {
  if (buf.length === 0) return { value: null, shouldReEncrypt: false };
  const asText = buf.toString("utf8");
  if (asText.startsWith(PLAINTEXT_TAG)) {
    return { value: asText.slice(PLAINTEXT_TAG.length), shouldReEncrypt: false };
  }
  const { result, shouldReEncrypt } = await backend.decryptStringAsync(buf);
  return { value: result, shouldReEncrypt };
}

/** Whether real OS encryption is in effect (false → plaintext fallback active). */
export function isSecureStorageAvailable(backend: SecureBackend): boolean {
  return backend.isEncryptionAvailable();
}
