import { describe, expect, it } from "vitest";
import { parseProxyPath } from "./proxy-url";

describe("parseProxyPath", () => {
  it("parses serverId + plexPath from a baked proxy URL", () => {
    const url = "http://127.0.0.1:51626/deadbeef/srv-1/library/metadata/979/thumb/123";
    expect(parseProxyPath(url)).toEqual({
      serverId: "srv-1",
      plexPath: "/library/metadata/979/thumb/123",
    });
  });
  it("preserves a query string", () => {
    const url = "http://127.0.0.1:9/sec/srv/library/parts/4/file.flac?x=1";
    expect(parseProxyPath(url)).toEqual({
      serverId: "srv",
      plexPath: "/library/parts/4/file.flac?x=1",
    });
  });
  it("returns null for non-proxy / malformed strings", () => {
    expect(parseProxyPath("/library/metadata/1/thumb/2")).toBeNull();
    expect(parseProxyPath("http://127.0.0.1:9/onlysecret")).toBeNull();
  });
});
