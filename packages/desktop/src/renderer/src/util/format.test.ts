import { describe, expect, it } from "vitest";
import { formatBytes, formatDuration } from "./format";

describe("formatDuration", () => {
  it("formats ms as m:ss", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(9000)).toBe("0:09");
    expect(formatDuration(75000)).toBe("1:15");
    expect(formatDuration(254000)).toBe("4:14");
  });
  it("handles hours as h:mm:ss", () => {
    expect(formatDuration(3_661_000)).toBe("1:01:01");
  });
  it("clamps negatives/NaN to 0:00", () => {
    expect(formatDuration(-5)).toBe("0:00");
    expect(formatDuration(Number.NaN)).toBe("0:00");
  });
});

describe("formatBytes", () => {
  it("formats bytes below 1 KiB", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
  });
  it("formats KiB/MiB/GiB with sensible precision", () => {
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(5 * 1024 ** 3)).toBe("5 GB");
    expect(formatBytes(1024 ** 4)).toBe("1 TB");
  });
});
