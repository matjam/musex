import { describe, expect, it, vi } from "vitest";
import { LastfmService } from "./lastfm-service";

function svc(fetchFn: typeof fetch) {
  return new LastfmService({
    fetchFn,
    openAuth: async () => {},
    getConfig: async () => ({
      apiKey: "K",
      scrobbling: true,
      loveOnRating: true,
      username: "u",
      connection: "",
    }),
    setConfig: async () => {},
    getSecret: async () => "S",
    setSecret: async () => {},
    getSessionKey: async () => "SK",
    setSessionKey: async () => {},
    clearSession: async () => {},
  });
}
const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });

type MockFetch = (url: string, init: { body: URLSearchParams }) => Promise<Response>;

describe("LastfmService", () => {
  it("scrobble posts track.scrobble with timestamp + sk", async () => {
    const fetchFn = vi.fn<MockFetch>(async () => ok({ scrobbles: {} }));
    await svc(fetchFn as never).scrobble(
      { artistName: "M83", title: "Wait", albumTitle: "Junk", durationMs: 240000 },
      1000,
    );
    const p = new URLSearchParams(fetchFn.mock.calls[0]?.[1].body.toString());
    expect(p.get("method")).toBe("track.scrobble");
    expect(p.get("artist")).toBe("M83");
    expect(p.get("track")).toBe("Wait");
    expect(p.get("timestamp")).toBe("1"); // 1000ms → 1s epoch
    expect(p.get("sk")).toBe("SK");
    expect(p.get("api_sig")).toBeTruthy();
  });
  it("similarArtists parses names (unsigned)", async () => {
    const fetchFn = vi.fn<MockFetch>(async () =>
      ok({ similarartists: { artist: [{ name: "Tycho" }, { name: "Washed Out" }] } }),
    );
    const names = await svc(fetchFn as never).similarArtists("M83");
    expect(names).toEqual(["Tycho", "Washed Out"]);
    const p = new URLSearchParams(fetchFn.mock.calls[0]?.[1].body.toString());
    expect(p.get("api_sig")).toBeNull(); // read method, unsigned
  });
  it("artistInfo returns an HTML-stripped bio", async () => {
    const fetchFn = vi.fn<MockFetch>(async () =>
      ok({
        artist: {
          name: "M83",
          bio: { summary: 'French project <a href="x">Read more</a> formed in 2001.' },
        },
      }),
    );
    const info = await svc(fetchFn as never).artistInfo("M83");
    expect(info?.bio).toBe("French project  formed in 2001.");
  });
  it("love uses track.love when connected", async () => {
    const fetchFn = vi.fn<MockFetch>(async () => ok({}));
    await svc(fetchFn as never).love({ artistName: "A", title: "T" });
    expect(new URLSearchParams(fetchFn.mock.calls[0]?.[1].body.toString()).get("method")).toBe(
      "track.love",
    );
  });
});
