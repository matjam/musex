import { describe, expect, it } from "vitest";
import { secureDecrypt, secureEncrypt } from "./secure-store";

const realBackend = {
  isEncryptionAvailable: () => true,
  encryptStringAsync: async (s: string) => Buffer.from(`ENC(${s})`),
  decryptStringAsync: async (b: Buffer) => ({
    result: b.toString().replace(/^ENC\((.*)\)$/, "$1"),
    shouldReEncrypt: false,
  }),
};
const noBackend = {
  isEncryptionAvailable: () => false,
  encryptStringAsync: async () => Buffer.alloc(0),
  decryptStringAsync: async () => ({ result: "", shouldReEncrypt: false }),
};
const reEncryptBackend = {
  isEncryptionAvailable: () => true,
  encryptStringAsync: async (s: string) => Buffer.from(`ENC(${s})`),
  decryptStringAsync: async (b: Buffer) => ({
    result: b.toString().replace(/^ENC\((.*)\)$/, "$1"),
    shouldReEncrypt: true,
  }),
};

describe("secure-store", () => {
  it("round-trips through a real backend", async () => {
    const buf = await secureEncrypt("tok", realBackend);
    const { value, shouldReEncrypt } = await secureDecrypt(buf, realBackend);
    expect(value).toBe("tok");
    expect(shouldReEncrypt).toBe(false);
  });

  it("falls back to tagged plaintext when encryption is unavailable", async () => {
    const buf = await secureEncrypt("tok", noBackend);
    expect(buf.toString("utf8").startsWith("musex-plaintext:v1:")).toBe(true);
    // plaintext is readable even by a backend that now reports available
    const { value, shouldReEncrypt } = await secureDecrypt(buf, realBackend);
    expect(value).toBe("tok");
    // tagged plaintext never needs re-encryption
    expect(shouldReEncrypt).toBe(false);
  });

  it("empty/garbage decrypts safely", async () => {
    const { value, shouldReEncrypt } = await secureDecrypt(Buffer.alloc(0), noBackend);
    expect(value).toBeNull();
    expect(shouldReEncrypt).toBe(false);
  });

  it("threads shouldReEncrypt:true through from the backend", async () => {
    const buf = await secureEncrypt("tok", reEncryptBackend);
    const { value, shouldReEncrypt } = await secureDecrypt(buf, reEncryptBackend);
    expect(value).toBe("tok");
    expect(shouldReEncrypt).toBe(true);
  });
});
