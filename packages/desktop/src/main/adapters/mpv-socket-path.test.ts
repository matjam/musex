import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { mpvSocketPath } from "./mpv-socket-path";

describe("mpvSocketPath", () => {
  it("returns a named pipe on win32", () => {
    expect(mpvSocketPath("win32", "C:/x", "abc")).toBe("\\\\.\\pipe\\musex-mpv-abc");
  });

  it("returns a userData socket file off-win32", () => {
    expect(mpvSocketPath("darwin", "/u", "x")).toBe(join("/u", "mpv.sock"));
  });

  it("generates a distinct pipe per call by default", () => {
    expect(mpvSocketPath("win32", "C:/x")).not.toBe(mpvSocketPath("win32", "C:/x"));
  });
});
