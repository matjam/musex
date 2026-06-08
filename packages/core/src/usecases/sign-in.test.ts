import { describe, expect, it } from "vitest";
import { FakePlexGateway, FakeTokenStore } from "../testing/fakes";
import { SignInTimeoutError, signIn } from "./sign-in";

function clock(values: number[]) {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)] ?? 0;
}

describe("signIn", () => {
  it("opens the auth URL, polls until a token appears, and saves it", async () => {
    const gateway = new FakePlexGateway();
    gateway.pollResults = [{ authToken: null }, { authToken: "tok-123" }];
    const tokenStore = new FakeTokenStore();
    const opened: string[] = [];

    const result = await signIn(
      {
        gateway,
        tokenStore,
        openAuthUrl: (url) => {
          opened.push(url);
        },
        wait: async () => {},
        now: clock([0, 1, 2]),
      },
      { pollIntervalMs: 1, timeoutMs: 1000 },
    );

    expect(opened).toEqual([gateway.pin.authUrl]);
    expect(result.token).toBe("tok-123");
    expect(tokenStore.saved).toEqual(["tok-123"]);
  });

  it("throws SignInTimeoutError when the token never appears in time", async () => {
    const gateway = new FakePlexGateway();
    gateway.pollResults = [{ authToken: null }];
    const tokenStore = new FakeTokenStore();

    await expect(
      signIn(
        {
          gateway,
          tokenStore,
          openAuthUrl: () => {},
          wait: async () => {},
          now: clock([0, 500, 1000, 1500]),
        },
        { pollIntervalMs: 1, timeoutMs: 1000 },
      ),
    ).rejects.toBeInstanceOf(SignInTimeoutError);
    expect(tokenStore.saved).toEqual([]);
  });
});
