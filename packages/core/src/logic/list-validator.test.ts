import { describe, expect, it } from "vitest";
import { listValidator } from "./list-validator";

describe("listValidator", () => {
  it("combines updatedAt and count into a stable string", () => {
    expect(listValidator(1717800000000, 42)).toBe("1717800000000:42");
  });
  it("defaults missing parts to 0 (stable, comparable)", () => {
    expect(listValidator()).toBe("0:0");
    expect(listValidator(123)).toBe("123:0");
    expect(listValidator(undefined, 5)).toBe("0:5");
  });
});
