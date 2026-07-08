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
  it("connectionType defaults to 'other' before any netinfo event", () => {
    const m = new ConnectivityMonitor({
      subscribe: () => () => {},
      probe: async () => {},
      onChange: () => {},
    });
    m.start();
    expect(m.connectionType()).toBe("other");
  });

  it("connectionType reflects the last netinfo event's type", () => {
    let net: (s: { isConnected: boolean | null; type?: string }) => void = () => {};
    const m = new ConnectivityMonitor({
      subscribe: (cb) => {
        net = cb;
        return () => {};
      },
      probe: async () => {},
      onChange: () => {},
    });
    m.start();
    net({ isConnected: true, type: "wifi" });
    expect(m.connectionType()).toBe("wifi");
    net({ isConnected: true, type: "cellular" });
    expect(m.connectionType()).toBe("cellular");
    net({ isConnected: true, type: "ethernet" });
    expect(m.connectionType()).toBe("other");
    net({ isConnected: true }); // type absent
    expect(m.connectionType()).toBe("none");
  });

  it("connectionType is 'none' when disconnected", () => {
    let net: (s: { isConnected: boolean | null; type?: string }) => void = () => {};
    const m = new ConnectivityMonitor({
      subscribe: (cb) => {
        net = cb;
        return () => {};
      },
      probe: async () => {},
      onChange: () => {},
    });
    m.start();
    net({ isConnected: false, type: "none" });
    expect(m.connectionType()).toBe("none");
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
