import { describe, expect, it } from "vitest";
import { isUpdateFeedUnavailable } from "./updater-feed-error";

describe("isUpdateFeedUnavailable", () => {
  it("matches the real missing-feed error (artifacts not uploaded yet)", () => {
    const err = new Error(
      "Cannot find latest-mac.yml in the latest release artifacts " +
        "(https://github.com/matjam/musex/releases/download/v0.16.3/latest-mac.yml): HttpError: 404",
    );
    expect(isUpdateFeedUnavailable(err)).toBe(true);
  });

  it("matches latest.yml / latest-linux.yml too", () => {
    expect(isUpdateFeedUnavailable(new Error("Cannot find latest.yml …"))).toBe(true);
    expect(isUpdateFeedUnavailable(new Error("Cannot find latest-linux.yml …"))).toBe(true);
  });

  it("matches an HttpError carrying statusCode 404", () => {
    expect(isUpdateFeedUnavailable({ message: "not found", statusCode: 404 })).toBe(true);
  });

  it("does NOT match genuine errors (offline, DNS, rate limit)", () => {
    expect(isUpdateFeedUnavailable(new Error("net::ERR_INTERNET_DISCONNECTED"))).toBe(false);
    expect(isUpdateFeedUnavailable(new Error("getaddrinfo ENOTFOUND github.com"))).toBe(false);
    expect(isUpdateFeedUnavailable({ message: "rate limited", statusCode: 403 })).toBe(false);
    expect(isUpdateFeedUnavailable(null)).toBe(false);
    expect(isUpdateFeedUnavailable(undefined)).toBe(false);
  });
});
