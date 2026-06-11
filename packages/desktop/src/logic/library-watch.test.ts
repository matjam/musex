import { describe, expect, it } from "vitest";
import {
  ChangeCoalescer,
  nextReconnectDelayMs,
  relevantSectionChange,
  timestampChanged,
} from "./library-watch";

function timelineMsg(entries: Array<Record<string, unknown>>): unknown {
  return {
    NotificationContainer: { type: "timeline", size: entries.length, TimelineEntry: entries },
  };
}
const ENTRY = {
  identifier: "com.plexapp.plugins.library",
  sectionID: "3",
  itemID: "999",
  type: 10,
  title: "New Track",
  state: 5,
  updatedAt: 1760000000,
};

describe("relevantSectionChange", () => {
  it("matches a processed item in our section", () => {
    expect(relevantSectionChange(timelineMsg([ENTRY]), "3")).toBe(true);
  });

  it("matches a deleted item (state 9)", () => {
    expect(relevantSectionChange(timelineMsg([{ ...ENTRY, state: 9 }]), "3")).toBe(true);
  });

  it("numeric sectionID still matches (Plex is inconsistent about types)", () => {
    expect(relevantSectionChange(timelineMsg([{ ...ENTRY, sectionID: 3 }]), "3")).toBe(true);
  });

  it("ignores other sections", () => {
    expect(relevantSectionChange(timelineMsg([ENTRY]), "7")).toBe(false);
  });

  it("ignores in-progress states 0-4", () => {
    for (const state of [0, 1, 2, 3, 4]) {
      expect(relevantSectionChange(timelineMsg([{ ...ENTRY, state }]), "3")).toBe(false);
    }
  });

  it("ignores non-library identifiers", () => {
    expect(
      relevantSectionChange(timelineMsg([{ ...ENTRY, identifier: "com.plexapp.system" }]), "3"),
    ).toBe(false);
  });

  it("ignores non-timeline notifications", () => {
    expect(
      relevantSectionChange(
        { NotificationContainer: { type: "playing", PlaySessionStateNotification: [] } },
        "3",
      ),
    ).toBe(false);
    expect(
      relevantSectionChange(
        { NotificationContainer: { type: "activity", ActivityNotification: [] } },
        "3",
      ),
    ).toBe(false);
  });

  it("tolerates malformed payloads", () => {
    expect(relevantSectionChange(null, "3")).toBe(false);
    expect(relevantSectionChange("garbage", "3")).toBe(false);
    expect(relevantSectionChange({}, "3")).toBe(false);
    expect(relevantSectionChange({ NotificationContainer: { type: "timeline" } }, "3")).toBe(false);
  });
});

describe("timestampChanged", () => {
  it("any inequality counts (a reset Plex DB must register too)", () => {
    expect(timestampChanged(100, 200)).toBe(true);
    expect(timestampChanged(200, 100)).toBe(true);
    expect(timestampChanged(100, 100)).toBe(false);
  });

  it("missing fresh value is not a change; missing prev with a fresh value is", () => {
    expect(timestampChanged(100, undefined)).toBe(false);
    expect(timestampChanged(undefined, 100)).toBe(true);
    expect(timestampChanged(undefined, undefined)).toBe(false);
  });
});

describe("nextReconnectDelayMs", () => {
  it("caps an exponential curve at 60s", () => {
    expect(nextReconnectDelayMs(0)).toBe(1_000);
    expect(nextReconnectDelayMs(1)).toBe(2_000);
    expect(nextReconnectDelayMs(2)).toBe(4_000);
    expect(nextReconnectDelayMs(5)).toBe(32_000);
    expect(nextReconnectDelayMs(6)).toBe(60_000);
    expect(nextReconnectDelayMs(50)).toBe(60_000);
  });
});

describe("ChangeCoalescer", () => {
  it("a lone change is due after the quiet period", () => {
    const c = new ChangeCoalescer(5_000, 30_000);
    expect(c.noteChange(1_000)).toBe(6_000);
  });

  it("further changes push the due time out (re-armed quiet period)", () => {
    const c = new ChangeCoalescer(5_000, 30_000);
    c.noteChange(1_000);
    expect(c.noteChange(4_000)).toBe(9_000);
  });

  it("the max wait bounds a long burst", () => {
    const c = new ChangeCoalescer(5_000, 30_000);
    c.noteChange(1_000);
    expect(c.noteChange(29_000)).toBe(31_000); // 1_000 + 30_000, not 34_000
  });

  it("reset starts a fresh window", () => {
    const c = new ChangeCoalescer(5_000, 30_000);
    c.noteChange(1_000);
    c.reset();
    expect(c.noteChange(50_000)).toBe(55_000);
  });
});
