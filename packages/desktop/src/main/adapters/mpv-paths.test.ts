import { describe, expect, it } from "vitest";
import { findSystemMpv } from "./mpv-paths";

describe("findSystemMpv", () => {
  /** Simulate a filesystem where `files` are regular files and `dirs` are directories. */
  const isFile =
    (files: string[], dirs: string[] = []) =>
    (p: string) =>
      files.includes(p) && !dirs.includes(p);

  it("finds mpv on PATH", () => {
    expect(findSystemMpv("/usr/bin:/usr/local/bin", isFile(["/usr/local/bin/mpv"]))).toBe(
      "/usr/local/bin/mpv",
    );
  });

  it("prefers the earliest PATH entry", () => {
    expect(findSystemMpv("/a:/b", isFile(["/a/mpv", "/b/mpv"]))).toBe("/a/mpv");
  });

  it("falls back to common locations when PATH misses", () => {
    expect(findSystemMpv("", isFile(["/usr/bin/mpv"]))).toBe("/usr/bin/mpv");
  });

  it("returns null when mpv is nowhere", () => {
    expect(findSystemMpv("/usr/bin:/x", isFile([]))).toBeNull();
  });

  it("tolerates an undefined PATH", () => {
    expect(findSystemMpv(undefined, isFile(["/usr/bin/mpv"]))).toBe("/usr/bin/mpv");
  });

  it("skips a candidate that exists as a directory rather than a file", () => {
    // /usr/local/bin/mpv exists but is a directory — must not be returned
    expect(findSystemMpv("/usr/local/bin", (_p) => false)).toBeNull();
  });

  it("skips a directory candidate and falls back to a real file on PATH", () => {
    // /a/mpv is a directory; /b/mpv is a real file — should return /b/mpv
    const check = (p: string) => p === "/b/mpv";
    expect(findSystemMpv("/a:/b", check)).toBe("/b/mpv");
  });
});
