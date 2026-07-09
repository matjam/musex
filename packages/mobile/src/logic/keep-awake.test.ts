import { describe, expect, it } from "vitest";
import { shouldKeepAwake } from "./keep-awake";

describe("shouldKeepAwake", () => {
  it("is true only when foreground AND in flight AND charging", () => {
    expect(shouldKeepAwake({ foreground: true, inFlight: true, charging: true })).toBe(true);
  });

  it("is false when any single condition drops", () => {
    expect(shouldKeepAwake({ foreground: false, inFlight: true, charging: true })).toBe(false);
    expect(shouldKeepAwake({ foreground: true, inFlight: false, charging: true })).toBe(false);
    expect(shouldKeepAwake({ foreground: true, inFlight: true, charging: false })).toBe(false);
  });

  it("is false for every remaining combination", () => {
    for (const foreground of [true, false]) {
      for (const inFlight of [true, false]) {
        for (const charging of [true, false]) {
          if (foreground && inFlight && charging) continue;
          expect(shouldKeepAwake({ foreground, inFlight, charging })).toBe(false);
        }
      }
    }
  });
});
