import { describe, expect, it } from "vitest";
import { deriveLayoutMode } from "./layout-mode";

describe("deriveLayoutMode", () => {
  it("phone regardless of dimensions", () =>
    expect(deriveLayoutMode({ width: 900, height: 400, isPad: false })).toBe("phone"));
  it("pad landscape when wider than tall", () =>
    expect(deriveLayoutMode({ width: 1194, height: 834, isPad: true })).toBe("pad-landscape"));
  it("pad portrait when taller than wide (and square counts as portrait)", () => {
    expect(deriveLayoutMode({ width: 834, height: 1194, isPad: true })).toBe("pad-portrait");
    expect(deriveLayoutMode({ width: 800, height: 800, isPad: true })).toBe("pad-portrait");
  });
});
