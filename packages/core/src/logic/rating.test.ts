import { describe, expect, it } from "vitest";
import { rating10FromStars, starsFromRating10 } from "./rating.js";

describe("rating conversion", () => {
  it("starsFromRating10 maps the 0–10 scale to 0–5 stars", () => {
    expect(starsFromRating10(null)).toBe(0);
    expect(starsFromRating10(0)).toBe(0);
    expect(starsFromRating10(8)).toBe(4); // LOVED_RATING
    expect(starsFromRating10(10)).toBe(5);
    expect(starsFromRating10(7)).toBe(4); // rounds (3.5 → 4)
  });

  it("rating10FromStars maps 1–5 stars back to the 0–10 scale", () => {
    expect(rating10FromStars(0)).toBe(0);
    expect(rating10FromStars(4)).toBe(8);
    expect(rating10FromStars(5)).toBe(10);
  });
});
