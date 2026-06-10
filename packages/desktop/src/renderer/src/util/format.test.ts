import { describe, expect, it } from "vitest";
import { formatBytes, formatDuration, relativeTime } from "./format";

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

describe("relativeTime", () => {
  const NOW = 1_000_000_000_000;
  const MIN = 60_000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;

  it("says 'just now' under a minute (and for future/invalid times)", () => {
    expect(relativeTime(NOW, NOW)).toBe("just now");
    expect(relativeTime(NOW - 59_000, NOW)).toBe("just now");
    expect(relativeTime(NOW + 5_000, NOW)).toBe("just now");
    expect(relativeTime(Number.NaN, NOW)).toBe("just now");
  });

  it("formats minutes and hours, singular and plural", () => {
    expect(relativeTime(NOW - MIN, NOW)).toBe("1 minute ago");
    expect(relativeTime(NOW - 45 * MIN, NOW)).toBe("45 minutes ago");
    expect(relativeTime(NOW - HOUR, NOW)).toBe("1 hour ago");
    expect(relativeTime(NOW - 23 * HOUR, NOW)).toBe("23 hours ago");
  });

  it("formats days, weeks, months coarsely", () => {
    expect(relativeTime(NOW - DAY, NOW)).toBe("1 day ago");
    expect(relativeTime(NOW - 6 * DAY, NOW)).toBe("6 days ago");
    expect(relativeTime(NOW - 7 * DAY, NOW)).toBe("1 week ago");
    expect(relativeTime(NOW - 29 * DAY, NOW)).toBe("4 weeks ago");
    expect(relativeTime(NOW - 30 * DAY, NOW)).toBe("1 month ago");
    expect(relativeTime(NOW - 365 * DAY, NOW)).toBe("12 months ago");
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
