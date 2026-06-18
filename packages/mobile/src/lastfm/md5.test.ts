import { describe, expect, it } from "vitest";
import { md5Hasher } from "./md5";

describe("md5Hasher", () => {
  it("produces the last.fm signing vector", () => {
    expect(md5Hasher("api_keyabcmethodauth.getTokensec")).toBe("3334e36028583f782c8e6db457c76835");
  });
  it("hashes UTF-8 correctly", () => {
    expect(md5Hasher("")).toBe("d41d8cd98f00b204e9800998ecf8427e");
  });
});
