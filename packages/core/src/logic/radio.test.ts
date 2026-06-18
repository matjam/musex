import { describe, expect, it } from "vitest";
import { advanceRadio, type RadioState, radioKey, shouldTopUp } from "./radio.js";

describe("radio coordination", () => {
  it("radioKey normalizes artist+title case/space", () => {
    expect(radioKey("M83", "Midnight City")).toBe(radioKey(" m83 ", "midnight city"));
  });
  it("shouldTopUp when active and up-next below the threshold", () => {
    expect(shouldTopUp({ active: true, emptyRounds: 0 }, 4)).toBe(true);
    expect(shouldTopUp({ active: true, emptyRounds: 0 }, 5)).toBe(false);
    expect(shouldTopUp({ active: false, emptyRounds: 0 }, 0)).toBe(false);
  });
  it("advanceRadio increments emptyRounds on no additions and stops after 2", () => {
    const s0: RadioState = { active: true, emptyRounds: 0 };
    const s1 = advanceRadio(s0, 0); // added 0
    expect(s1.emptyRounds).toBe(1);
    const s2 = advanceRadio(s1, 0);
    expect(s2).toEqual({ active: false, emptyRounds: 2 });
  });
  it("advanceRadio resets emptyRounds when tracks were added", () => {
    expect(advanceRadio({ active: true, emptyRounds: 1 }, 3)).toEqual({
      active: true,
      emptyRounds: 0,
    });
  });
});
