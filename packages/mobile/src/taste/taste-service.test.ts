import { describe, expect, it, vi } from "vitest";

vi.mock("../adapters/taste-persistence", () => ({
  loadTasteState: vi.fn(async () => null),
  saveTasteState: vi.fn(async () => {}),
}));

import { TasteService } from "./taste-service";

describe("TasteService.recordTrackRating", () => {
  it("records a rating that surfaces in the snapshot's trackStats", async () => {
    const svc = new TasteService();
    await svc.init();
    svc.recordTrackRating({ title: "Wait", artistName: "M83" }, 8);
    const snap = svc.snapshot();
    const stat = snap.trackStats.find((s) => s.key.includes("wait"));
    expect(stat?.ratingStars).toBe(4);
  });
});
