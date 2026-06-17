import { describe, expect, it } from "vitest";
import { trackAvailability, type LocalPresence } from "./offline-availability.js";

const p = (downloaded: boolean, cached: boolean): LocalPresence => ({ downloaded, cached });

describe("trackAvailability", () => {
  it("online: everything is playable", () => {
    expect(trackAvailability(p(false, false), true)).toBe("playable");
    expect(trackAvailability(p(true, false), true)).toBe("playable");
  });
  it("offline: downloaded or cached is playable", () => {
    expect(trackAvailability(p(true, false), false)).toBe("playable");
    expect(trackAvailability(p(false, true), false)).toBe("playable");
  });
  it("offline: neither downloaded nor cached is dimmed", () => {
    expect(trackAvailability(p(false, false), false)).toBe("unavailable-offline");
  });
});
