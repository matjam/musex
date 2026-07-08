import { describe, expect, it } from "vitest";
import { type ConnectionType, transferModeFor } from "./transfer-mode.js";

describe("transferModeFor", () => {
  it("original quality is always mode original (regardless of network/native)", () => {
    for (const connectionType of ["wifi", "cellular", "other", "none"] as ConnectionType[]) {
      for (const nativeConvertAvailable of [true, false]) {
        expect(
          transferModeFor({ qualityMode: "original", nativeConvertAvailable, connectionType }),
        ).toBe("original");
      }
    }
  });

  it("aac + native convert + wifi → convert", () => {
    expect(
      transferModeFor({ qualityMode: "aac", nativeConvertAvailable: true, connectionType: "wifi" }),
    ).toBe("convert");
  });

  it("aac + native convert + cellular → hls (data-cost carve-out)", () => {
    expect(
      transferModeFor({
        qualityMode: "aac",
        nativeConvertAvailable: true,
        connectionType: "cellular",
      }),
    ).toBe("hls");
  });

  it("aac without native convert → hls on every connection type", () => {
    for (const connectionType of ["wifi", "cellular", "other", "none"] as ConnectionType[]) {
      expect(
        transferModeFor({ qualityMode: "aac", nativeConvertAvailable: false, connectionType }),
      ).toBe("hls");
    }
  });

  it("aac + native convert + other/none count as non-cellular → convert", () => {
    for (const connectionType of ["other", "none"] as ConnectionType[]) {
      expect(
        transferModeFor({ qualityMode: "aac", nativeConvertAvailable: true, connectionType }),
      ).toBe("convert");
    }
  });
});
