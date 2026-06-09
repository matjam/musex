import os from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { EngineEvent } from "../../logic/mpv-ipc.js";
import { MpvController } from "./mpv-controller.js";

const RUN = process.env.MUSEX_MPV_E2E;
const run = RUN ? describe : describe.skip;

// Test file lives at packages/desktop/src/main/adapters/ → repo root is 5 up.
const BINARY = fileURLToPath(
  new URL("../../../../../vendor/mpv/darwin-arm64/mpv.app/Contents/MacOS/mpv", import.meta.url),
);

async function waitFor(pred: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!pred()) {
    if (Date.now() >= deadline) throw new Error("timed out waiting for condition");
    await new Promise((r) => setTimeout(r, 50));
  }
}

run("MpvController (real vendored mpv, env-gated)", () => {
  it("plays a 1s sine to completion: position events then ended", async () => {
    const controller = new MpvController({
      binaryPath: BINARY,
      socketPath: join(os.tmpdir(), "musex-mpv-test.sock"),
    });
    const events: EngineEvent[] = [];
    controller.setSink((e) => events.push(e));
    try {
      await controller.start();
      await controller.load("av://lavfi:sine=frequency=440:duration=1");
      await controller.play();

      await waitFor(() => events.some((e) => e.type === "position"));
      await waitFor(() => events.some((e) => e.type === "ended"));

      const firstPosition = events.findIndex((e) => e.type === "position");
      const endedAt = events.findIndex((e) => e.type === "ended");
      expect(firstPosition).toBeGreaterThanOrEqual(0);
      expect(endedAt).toBeGreaterThan(firstPosition);
      expect(events.some((e) => e.type === "error")).toBe(false);
      // No spurious auto-advance: the only load was explicit.
      expect(events.some((e) => e.type === "advanced")).toBe(false);
    } finally {
      await controller.dispose();
    }
  }, 30_000);
});
