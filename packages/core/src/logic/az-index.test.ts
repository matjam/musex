import { describe, expect, it } from "vitest";
import { buildLetterIndex, letterFor } from "./az-index.js";

describe("letterFor", () => {
  it("uppercases the first letter", () => {
    expect(letterFor("arcade fire")).toBe("A");
    expect(letterFor("Zaz")).toBe("Z");
  });
  it("maps digits, symbols, accents and empty to #", () => {
    expect(letterFor("2Pac")).toBe("#");
    expect(letterFor("")).toBe("#");
    expect(letterFor("  ")).toBe("#");
    expect(letterFor("Éclair")).toBe("#");
  });
});

describe("buildLetterIndex", () => {
  it("maps each present letter to the first index in a sorted list", () => {
    const items = ["ABBA", "Air", "Beck", "Zaz"];
    const { letters, indexOf } = buildLetterIndex(items, (s) => s);
    expect(letters).toEqual(["A", "B", "Z"]);
    expect(indexOf).toEqual({ A: 0, B: 2, Z: 3 });
  });
  it("orders # first when present", () => {
    const items = ["2Pac", "ABBA"];
    const { letters } = buildLetterIndex(items, (s) => s);
    expect(letters).toEqual(["#", "A"]);
  });
});
