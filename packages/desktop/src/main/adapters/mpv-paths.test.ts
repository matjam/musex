import { describe, expect, it } from "vitest";
import { findSystemMpv } from "./mpv-paths";

describe("findSystemMpv", () => {
  const exists = (set: string[]) => (p: string) => set.includes(p);

  it("finds mpv on PATH", () => {
    expect(findSystemMpv("/usr/bin:/usr/local/bin", exists(["/usr/local/bin/mpv"]))).toBe(
      "/usr/local/bin/mpv",
    );
  });

  it("prefers the earliest PATH entry", () => {
    expect(findSystemMpv("/a:/b", exists(["/a/mpv", "/b/mpv"]))).toBe("/a/mpv");
  });

  it("falls back to common locations when PATH misses", () => {
    expect(findSystemMpv("", exists(["/usr/bin/mpv"]))).toBe("/usr/bin/mpv");
  });

  it("returns null when mpv is nowhere", () => {
    expect(findSystemMpv("/usr/bin:/x", exists([]))).toBeNull();
  });

  it("tolerates an undefined PATH", () => {
    expect(findSystemMpv(undefined, exists(["/usr/bin/mpv"]))).toBe("/usr/bin/mpv");
  });
});
