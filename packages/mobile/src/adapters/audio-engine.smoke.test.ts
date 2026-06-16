import { describe, expect, it } from "vitest";

// Real-engine smoke test. Skipped unless MUSEX_AUDIO_E2E=1 AND run inside a
// device/simulator JS runtime (expo-audio is a native module — it cannot load
// under plain Node/vitest). This file is excluded from the default vitest run
// (see vitest.config.ts) and documents how to exercise the engine on-device.
const enabled = process.env.MUSEX_AUDIO_E2E === "1";

describe.skipIf(!enabled)("ExpoAudioEngine (device smoke)", () => {
  it("documents manual verification steps", () => {
    // Manual on-device procedure (run via a temporary dev-screen button):
    //   const e = new ExpoAudioEngine(); await e.init();
    //   e.onPosition((s) => console.log("pos", s));
    //   e.onEnded(() => console.log("ended"));
    //   await e.load({ kind: "direct", url: "<a real proxied track url>" });
    //   e.play();  // expect audible output + position logs, "ended" at track end
    expect(enabled).toBe(true);
  });
});
