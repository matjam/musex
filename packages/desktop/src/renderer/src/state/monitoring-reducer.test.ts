import { describe, expect, it } from "vitest";
import {
  isMonitored,
  isWatched,
  type MonitoringState,
  monitoringReducer,
} from "./monitoring-reducer";

const empty: MonitoringState = { monitored: new Set(), watched: new Set() };

describe("monitoringReducer", () => {
  it("seeds from server lists (case-insensitive)", () => {
    const s = monitoringReducer(empty, {
      type: "seed",
      monitored: ["Bonobo"],
      watched: ["Tycho"],
    });
    expect(isMonitored(s, "bonobo")).toBe(true);
    expect(isWatched(s, "TYCHO")).toBe(true);
  });
  it("setMonitored adds/removes optimistically", () => {
    let s = monitoringReducer(empty, { type: "setMonitored", name: "Bonobo", value: true });
    expect(isMonitored(s, "bonobo")).toBe(true);
    s = monitoringReducer(s, { type: "setMonitored", name: "Bonobo", value: false });
    expect(isMonitored(s, "bonobo")).toBe(false);
  });
  it("setWatched toggles watched independently", () => {
    const s = monitoringReducer(empty, { type: "setWatched", name: "Bonobo", value: true });
    expect(isWatched(s, "bonobo")).toBe(true);
    expect(isMonitored(s, "bonobo")).toBe(false);
  });
});
