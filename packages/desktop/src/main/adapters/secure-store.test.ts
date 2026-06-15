import { describe, expect, it } from "vitest";
import { secureDecrypt, secureEncrypt } from "./secure-store";

const realBackend = {
  isEncryptionAvailable: () => true,
  encryptString: (s: string) => Buffer.from(`ENC(${s})`),
  decryptString: (b: Buffer) => b.toString().replace(/^ENC\((.*)\)$/, "$1"),
};
const noBackend = {
  isEncryptionAvailable: () => false,
  encryptString: () => Buffer.alloc(0),
  decryptString: () => "",
};

describe("secure-store", () => {
  it("round-trips through a real backend", () => {
    const buf = secureEncrypt("tok", realBackend);
    expect(secureDecrypt(buf, realBackend)).toBe("tok");
  });

  it("falls back to tagged plaintext when encryption is unavailable", () => {
    const buf = secureEncrypt("tok", noBackend);
    expect(buf.toString("utf8").startsWith("musex-plaintext:v1:")).toBe(true);
    // plaintext is readable even by a backend that now reports available
    expect(secureDecrypt(buf, realBackend)).toBe("tok");
  });

  it("empty/garbage decrypts safely", () => {
    expect(secureDecrypt(Buffer.alloc(0), noBackend)).toBeNull();
  });
});
