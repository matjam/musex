import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sign } from "./signing.js";

const md5 = (s: string) => createHash("md5").update(s, "utf8").digest("hex");

describe("sign", () => {
  it("matches a hand-computed vector (sorted name+value concat + secret)", () => {
    const sig = sign({ api_key: "abc", method: "auth.getToken" }, "sec");
    // md5("api_keyabcmethodauth.getTokensec") — both derived and literal.
    expect(sig).toBe(md5("api_keyabcmethodauth.getTokensec"));
    expect(sig).toBe("3334e36028583f782c8e6db457c76835");
  });

  it("sorts by param NAME regardless of insertion order", () => {
    const a = sign({ method: "auth.getToken", api_key: "abc" }, "sec");
    const b = sign({ api_key: "abc", method: "auth.getToken" }, "sec");
    expect(a).toBe(b);
    expect(a).toBe("3334e36028583f782c8e6db457c76835");
  });

  it("signs sk-bearing calls with values interleaved after their names", () => {
    const sig = sign(
      { method: "track.love", api_key: "k", sk: "s", artist: "Lamb", track: "Gorecki" },
      "secret",
    );
    // names sorted: api_key, artist, method, sk, track — then the secret.
    expect(sig).toBe(md5("api_keykartistLambmethodtrack.loveskstrackGoreckisecret"));
  });
});
