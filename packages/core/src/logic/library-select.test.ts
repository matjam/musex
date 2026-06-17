import { describe, expect, it } from "vitest";
import type { Library, Server } from "../index.js";
import { pickDefaultLibrary, pickDefaultServer } from "./library-select.js";

function srv(id: string, owned?: boolean): Server {
  return { id, name: id, connections: [], owned };
}
function lib(id: string, owned?: boolean): Library {
  return { id, serverId: "s", serverName: "s", title: id, type: "music", owned };
}

describe("pickDefaultServer", () => {
  it("prefers an owned server", () => {
    expect(pickDefaultServer([srv("a"), srv("b", true), srv("c")])?.id).toBe("b");
  });
  it("falls back to the first when none owned", () => {
    expect(pickDefaultServer([srv("a"), srv("b")])?.id).toBe("a");
  });
  it("returns null for an empty list", () => {
    expect(pickDefaultServer([])).toBeNull();
  });
});

describe("pickDefaultLibrary", () => {
  it("prefers an owned library", () => {
    expect(pickDefaultLibrary([lib("a"), lib("b", true)])?.id).toBe("b");
  });
  it("falls back to the first when none owned", () => {
    expect(pickDefaultLibrary([lib("a"), lib("b")])?.id).toBe("a");
  });
  it("returns null for an empty list", () => {
    expect(pickDefaultLibrary([])).toBeNull();
  });
});
