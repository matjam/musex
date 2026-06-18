import { describe, expect, it, vi } from "vitest";
import {
  isLastfmError,
  LastfmClient,
  LastfmError,
  type LastfmFetch,
  type LastfmResponse,
  sign,
} from "./lastfm-protocol.js";

// A deterministic fake hasher: wraps its input so a test can assert EXACTLY
// what was signed, with no dependency on a real MD5. (Real-MD5 correctness is
// covered by the mobile js-md5 test and the desktop service test, against the
// known last.fm vector — core only needs to prove the concat/sort/injection.)
const fakeHasher = (s: string): string => `H(${s})`;

const resp = (body: unknown, status = 200): LastfmResponse => ({
  ok: status < 400,
  status,
  json: async () => body,
});

describe("sign", () => {
  it("concatenates params sorted by NAME (name+value), appends the secret, then hashes", () => {
    expect(sign({ api_key: "abc", method: "auth.getToken" }, "sec", fakeHasher)).toBe(
      "H(api_keyabcmethodauth.getTokensec)",
    );
  });
  it("sorts by param NAME regardless of insertion order", () => {
    expect(sign({ method: "auth.getToken", api_key: "abc" }, "sec", fakeHasher)).toBe(
      sign({ api_key: "abc", method: "auth.getToken" }, "sec", fakeHasher),
    );
  });
});

describe("LastfmClient", () => {
  function clientWith(body: unknown, status = 200) {
    const fetchFn = vi.fn<LastfmFetch>(async () => resp(body, status));
    const c = new LastfmClient({ apiKey: "K", secret: "S", fetchFn, hasher: fakeHasher });
    return { c, fetchFn };
  }

  it("signs by default and appends format=json AFTER signing (excluded from the signature)", async () => {
    const { c, fetchFn } = clientWith({ ok: 1 });
    await c.call("track.love", { artist: "A", track: "T" }, { sk: "SK" });
    const body = fetchFn.mock.calls[0]![1].body;
    expect(body.get("method")).toBe("track.love");
    expect(body.get("sk")).toBe("SK");
    expect(body.get("format")).toBe("json");
    expect(body.get("api_sig")).toBe("H(api_keyKartistAmethodtrack.loveskSKtrackTS)");
  });

  it("skips the signature when signed:false", async () => {
    const { c, fetchFn } = clientWith({ ok: 1 });
    await c.call("artist.getInfo", { artist: "A" }, { signed: false });
    expect(fetchFn.mock.calls[0]![1].body.get("api_sig")).toBeNull();
  });

  it("throws LastfmError on an { error } body", async () => {
    const { c } = clientWith({ error: 14, message: "bad token" });
    await expect(c.call("auth.getSession", { token: "x" })).rejects.toBeInstanceOf(LastfmError);
  });

  it("isLastfmError matches the error code", async () => {
    const { c } = clientWith({ error: 14, message: "bad token" });
    try {
      await c.call("auth.getSession", { token: "x" });
      expect.unreachable("call should have thrown");
    } catch (e) {
      expect(isLastfmError(e, 14)).toBe(true);
      expect(isLastfmError(e, 9)).toBe(false);
    }
  });
});
