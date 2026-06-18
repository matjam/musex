import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { isLastfmError, LastfmClient, LastfmError, sign } from "./lastfm-protocol.js";

const md5 = (s: string): string => createHash("md5").update(s, "utf8").digest("hex");

describe("sign", () => {
  it("matches the hand-computed vector (sorted name+value concat + secret)", () => {
    expect(sign({ api_key: "abc", method: "auth.getToken" }, "sec", md5)).toBe(
      "3334e36028583f782c8e6db457c76835",
    );
  });
  it("sorts by param NAME regardless of insertion order", () => {
    expect(sign({ method: "auth.getToken", api_key: "abc" }, "sec", md5)).toBe(
      sign({ api_key: "abc", method: "auth.getToken" }, "sec", md5),
    );
  });
});

describe("LastfmClient", () => {
  it("signs by default, appends format=json after signing, POSTs form-encoded", async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ ok: 1 }), { status: 200 }));
    const c = new LastfmClient({ apiKey: "K", secret: "S", fetchFn, hasher: md5 });
    await c.call("track.love", { artist: "A", track: "T" }, { sk: "SK" });
    const body = (fetchFn.mock.calls[0]?.[1] as { body: URLSearchParams }).body;
    const params = new URLSearchParams(body.toString());
    expect(params.get("method")).toBe("track.love");
    expect(params.get("sk")).toBe("SK");
    expect(params.get("format")).toBe("json");
    expect(params.get("api_sig")).toBe(md5(`api_keyKartistAmethodtrack.loveskSKtrackTS`));
  });
  it("skips the signature when signed:false", async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ ok: 1 }), { status: 200 }));
    const c = new LastfmClient({ apiKey: "K", secret: "S", fetchFn, hasher: md5 });
    await c.call("artist.getInfo", { artist: "A" }, { signed: false });
    const params = new URLSearchParams(
      (fetchFn.mock.calls[0]?.[1] as { body: URLSearchParams }).body.toString(),
    );
    expect(params.get("api_sig")).toBeNull();
  });
  it("throws LastfmError on an { error } body", async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: 14, message: "bad token" }), { status: 200 }),
    );
    const c = new LastfmClient({ apiKey: "K", secret: "S", fetchFn, hasher: md5 });
    await expect(c.call("auth.getSession", { token: "x" })).rejects.toBeInstanceOf(LastfmError);
    try {
      await c.call("auth.getSession", { token: "x" });
    } catch (e) {
      expect(isLastfmError(e, 14)).toBe(true);
    }
  });
});
