import { describe, expect, it } from "vitest";
import { EMPTY_HISTORY, goBack, goForward, pushView, sameView } from "./nav-history";

type V = { name: string; id?: number };
const A: V = { name: "home" };
const B: V = { name: "albums" };
const C: V = { name: "artist", id: 7 };

describe("sameView", () => {
  it("structural equality", () => {
    expect(sameView({ name: "artist", id: 7 }, { name: "artist", id: 7 })).toBe(true);
    expect(sameView({ name: "artist", id: 7 }, { name: "artist", id: 8 })).toBe(false);
  });
});

describe("pushView", () => {
  it("pushes current onto back and clears forward", () => {
    const h1 = pushView(EMPTY_HISTORY, A);
    const h2 = pushView({ ...h1, forward: [C] }, B);
    expect(h2.back).toEqual([A, B]);
    expect(h2.forward).toEqual([]);
  });

  it("caps the back stack at 50 (oldest dropped)", () => {
    let h: { back: V[]; forward: V[] } = EMPTY_HISTORY;
    for (let i = 0; i < 60; i++) h = pushView(h, { name: "v", id: i });
    expect(h.back).toHaveLength(50);
    expect(h.back[0]).toEqual({ name: "v", id: 10 });
  });
});

describe("goBack / goForward", () => {
  it("round-trips", () => {
    const h = pushView(pushView(EMPTY_HISTORY, A), B); // back: [A, B], current is C
    const b = goBack(h, C);
    expect(b).not.toBeNull();
    expect(b?.view).toEqual(B);
    expect(b?.history.back).toEqual([A]);
    expect(b?.history.forward).toEqual([C]);
    const f = goForward(b!.history, b!.view);
    expect(f?.view).toEqual(C);
    expect(f?.history.back).toEqual([A, B]);
    expect(f?.history.forward).toEqual([]);
  });

  it("empty stacks are no-ops (null)", () => {
    expect(goBack(EMPTY_HISTORY, A)).toBeNull();
    expect(goForward(EMPTY_HISTORY, A)).toBeNull();
  });
});
