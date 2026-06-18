import { PlexAuthError } from "@musex/core";
import { describe, expect, it } from "vitest";
import { ConnectivityMonitor } from "./connectivity-monitor";

describe("ConnectivityMonitor", () => {
  it("netinfo no-connection → offline immediately", async () => {
    let net: (s: { isConnected: boolean | null }) => void = () => {};
    const states: string[] = [];
    const m = new ConnectivityMonitor({
      subscribe: (cb) => {
        net = cb;
        return () => {};
      },
      probe: async () => {},
      onChange: (s) => states.push(s),
    });
    m.start();
    net({ isConnected: false });
    expect(states.at(-1)).toBe("offline");
  });
  it("PlexAuthError from the probe does NOT mark offline", async () => {
    const states: string[] = [];
    const m = new ConnectivityMonitor({
      subscribe: () => () => {},
      probe: async () => {
        throw new PlexAuthError();
      },
      onChange: (s) => states.push(s),
    });
    await m.checkNow();
    expect(states).not.toContain("offline");
  });
  it("two consecutive non-auth probe failures → offline", async () => {
    const states: string[] = [];
    const m = new ConnectivityMonitor({
      subscribe: () => () => {},
      probe: async () => {
        throw new Error("network");
      },
      onChange: (s) => states.push(s),
    });
    await m.checkNow();
    await m.checkNow();
    expect(states.at(-1)).toBe("offline");
  });
});
