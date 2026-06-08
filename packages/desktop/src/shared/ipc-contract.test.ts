import { describe, expect, it } from "vitest";
import { IPC } from "./ipc-contract";

describe("IPC contract", () => {
  it("has unique, namespaced channel strings", () => {
    const values = Object.values(IPC);
    expect(new Set(values).size).toBe(values.length);
    for (const v of values) expect(v.startsWith("musex:")).toBe(true);
  });
});
