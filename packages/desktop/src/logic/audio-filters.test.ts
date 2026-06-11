import { describe, expect, it } from "vitest";
import {
  buildAf,
  DEFAULT_AUDIO_PREFS,
  EQ_PRESETS,
  replaygainMode,
  sanitizeAudioPrefs,
} from "./audio-filters";

describe("buildAf", () => {
  it("everything off → empty string", () => {
    expect(buildAf({ leveling: "off", eqPreset: "off" })).toBe("");
  });

  it("replaygain leveling adds no filter (it is a separate property)", () => {
    expect(buildAf({ leveling: "replaygain", eqPreset: "off" })).toBe("");
  });

  it("eq only", () => {
    expect(buildAf({ leveling: "off", eqPreset: "bass-boost" })).toBe("lavfi=[bass=g=6:f=110]");
  });

  it("auto leveling only", () => {
    expect(buildAf({ leveling: "auto", eqPreset: "off" })).toBe("lavfi=[dynaudnorm]");
  });

  it("eq + auto leveling: dynaudnorm comes after the EQ", () => {
    expect(buildAf({ leveling: "auto", eqPreset: "loudness" })).toBe(
      "lavfi=[bass=g=5:f=100,treble=g=3:f=8000,dynaudnorm]",
    );
  });

  it("every non-off preset produces a lavfi graph", () => {
    for (const p of EQ_PRESETS.filter((p) => p.id !== "off")) {
      expect(buildAf({ leveling: "off", eqPreset: p.id })).toBe(`lavfi=[${p.graph}]`);
    }
  });
});

describe("replaygainMode", () => {
  it("maps replaygain → album, everything else → no", () => {
    expect(replaygainMode({ leveling: "replaygain", eqPreset: "off" })).toBe("album");
    expect(replaygainMode({ leveling: "off", eqPreset: "off" })).toBe("no");
    expect(replaygainMode({ leveling: "auto", eqPreset: "off" })).toBe("no");
  });
});

describe("sanitizeAudioPrefs", () => {
  it("passes valid prefs through", () => {
    expect(sanitizeAudioPrefs({ leveling: "auto", eqPreset: "vocal" })).toEqual({
      leveling: "auto",
      eqPreset: "vocal",
    });
  });

  it("garbage in → defaults out", () => {
    expect(sanitizeAudioPrefs(null)).toEqual(DEFAULT_AUDIO_PREFS);
    expect(sanitizeAudioPrefs(undefined)).toEqual(DEFAULT_AUDIO_PREFS);
    expect(sanitizeAudioPrefs("x")).toEqual(DEFAULT_AUDIO_PREFS);
    expect(sanitizeAudioPrefs({ leveling: "extreme", eqPreset: "metal" })).toEqual(
      DEFAULT_AUDIO_PREFS,
    );
  });

  it("mixed: keeps the valid field, defaults the invalid one", () => {
    expect(sanitizeAudioPrefs({ leveling: "auto", eqPreset: 7 })).toEqual({
      leveling: "auto",
      eqPreset: "off",
    });
  });
});
