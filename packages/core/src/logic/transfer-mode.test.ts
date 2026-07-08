import { describe, expect, it } from "vitest";
import { type ConnectionType, isAvConvertible, transferModeFor } from "./transfer-mode.js";

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

describe("isAvConvertible", () => {
  it("allows every AVFoundation-readable container", () => {
    for (const c of ["flac", "mp3", "m4a", "aac", "alac", "wav", "aiff", "aif", "caf", "mp4"]) {
      expect(isAvConvertible(c)).toBe(true);
    }
  });

  it("is case/whitespace-insensitive", () => {
    expect(isAvConvertible("FLAC")).toBe(true);
    expect(isAvConvertible(" mp3 ")).toBe(true);
  });

  it("rejects containers AVFoundation cannot open (ogg/opus/wma)", () => {
    for (const c of ["ogg", "oga", "opus", "wma", "mka", "webm"]) {
      expect(isAvConvertible(c)).toBe(false);
    }
  });

  it("empty/unknown container allows convert (terminal-failure path backstops)", () => {
    expect(isAvConvertible("")).toBe(true);
    expect(isAvConvertible("   ")).toBe(true);
  });
});
