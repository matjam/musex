import { safeStorage } from "electron";
import {
  isSecureStorageAvailable as _isSecureStorageAvailable,
  secureDecrypt as _secureDecrypt,
  secureEncrypt as _secureEncrypt,
  type SecureBackend,
} from "./secure-store.js";

export type { SecureBackend };

const electronBackend = safeStorage as unknown as SecureBackend;

export function secureEncrypt(plain: string): Promise<Buffer> {
  return _secureEncrypt(plain, electronBackend);
}

export function secureDecrypt(
  buf: Buffer,
): Promise<{ value: string | null; shouldReEncrypt: boolean }> {
  return _secureDecrypt(buf, electronBackend);
}

export function isSecureStorageAvailable(): boolean {
  return _isSecureStorageAvailable(electronBackend);
}
