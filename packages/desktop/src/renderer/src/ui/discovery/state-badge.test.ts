import { describe, expect, it } from "vitest";
import { acquisitionBadge } from "./state-badge";

describe("acquisitionBadge", () => {
  it("maps owned to the In library label + variant", () => {
    expect(acquisitionBadge("owned")).toEqual({ label: "In library", variant: "owned" });
  });
  it("includes percent for downloading when provided", () => {
    expect(acquisitionBadge("downloading", 45)).toEqual({
      label: "Downloading 45%",
      variant: "downloading",
    });
  });
  it("downloading without percent omits it", () => {
    expect(acquisitionBadge("downloading")).toEqual({
      label: "Downloading",
      variant: "downloading",
    });
  });
  it("maps available to Get", () => {
    expect(acquisitionBadge("available")).toEqual({ label: "Get", variant: "available" });
  });
  it("returns null for an unknown state", () => {
    expect(acquisitionBadge("bogus" as never)).toBeNull();
  });
});
