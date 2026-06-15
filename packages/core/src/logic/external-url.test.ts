import { describe, expect, it } from "vitest";
import { isHttpUrl, validExternalImageUrl } from "./external-url";

describe("isHttpUrl", () => {
  it("accepts http and https", () => {
    expect(isHttpUrl("https://example.com/x")).toBe(true);
    expect(isHttpUrl("http://example.com/x")).toBe(true);
  });
  it("rejects other schemes", () => {
    expect(isHttpUrl("file:///etc/passwd")).toBe(false);
    expect(isHttpUrl("javascript:alert(1)")).toBe(false);
  });
});

describe("validExternalImageUrl", () => {
  it("accepts a plain https URL and returns it normalized", () => {
    expect(validExternalImageUrl("https://lastfm.freetls.fastly.net/i/u/300x300/abc.png")).toBe(
      "https://lastfm.freetls.fastly.net/i/u/300x300/abc.png",
    );
  });
  it("preserves query strings", () => {
    expect(validExternalImageUrl("https://img.example.com/a.jpg?size=300")).toBe(
      "https://img.example.com/a.jpg?size=300",
    );
  });
  it("rejects http (proxy fetches verbatim — https only)", () => {
    expect(validExternalImageUrl("http://img.example.com/a.jpg")).toBeUndefined();
  });
  it("rejects non-http(s) schemes", () => {
    expect(validExternalImageUrl("file:///etc/passwd")).toBeUndefined();
    expect(validExternalImageUrl("data:image/png;base64,AAAA")).toBeUndefined();
    expect(validExternalImageUrl("ftp://example.com/a.jpg")).toBeUndefined();
  });
  it("rejects unparseable / empty / missing input", () => {
    expect(validExternalImageUrl("not a url")).toBeUndefined();
    expect(validExternalImageUrl("")).toBeUndefined();
    expect(validExternalImageUrl(null)).toBeUndefined();
    expect(validExternalImageUrl(undefined)).toBeUndefined();
  });
});
