import { describe, expect, it } from "vitest";
import { gridColumns } from "./grid-columns";

describe("gridColumns", () => {
  it("phone width stays 2 columns", () => expect(gridColumns(390)).toBe(2));
  it("iPad portrait pane gets 4", () => expect(gridColumns(768)).toBe(4));
  it("iPad landscape pane gets 6", () => expect(gridColumns(1100)).toBe(6));
  it("unmeasured (0) falls back to 2", () => expect(gridColumns(0)).toBe(2));
});
