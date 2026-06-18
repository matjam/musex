import type { PluginManifest } from "@musex/plugin-api";
import type { BridgeRegState } from "@musex/plugin-host";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type TransportChannel, WebViewTransport } from "./webview-transport.js";

const MANIFEST: PluginManifest = {
  id: "demo",
  name: "Demo",
  version: "1.0.0",
  apiVersion: 2,
  entry: "index.mjs",
};

const REG_STATE: BridgeRegState = {
  acquisition: false,
  acquisitionMethods: [],
  recommender: false,
  settingsActions: [],
  similar: [],
  sections: {},
  trackActions: [],
  trackActionMeta: {},
  trackDetail: [],
  eventHandlers: [],
};

class FakeChannel implements TransportChannel {
  posted: unknown[] = [];
  post(msg: string): void {
    this.posted.push(JSON.parse(msg));
  }
  last(): Record<string, unknown> {
    return this.posted[this.posted.length - 1] as Record<string, unknown>;
  }
}

describe("WebViewTransport", () => {
  let channel: FakeChannel;
  let transport: WebViewTransport;

  beforeEach(() => {
    channel = new FakeChannel();
    transport = new WebViewTransport(channel, { timeoutMs: 50 });
  });

  it("resolves invoke when a matching invokeResult arrives", async () => {
    const p = transport.invoke("demo", "acquisition", "status", []);
    const sent = channel.last();
    expect(sent.type).toBe("invoke");
    expect(sent.pluginId).toBe("demo");
    expect(sent.path).toBe("acquisition");
    expect(sent.method).toBe("status");
    transport.onMessage(JSON.stringify({ type: "invokeResult", id: sent.id, result: [{ ok: 1 }] }));
    await expect(p).resolves.toEqual([{ ok: 1 }]);
  });

  it("resolves load with the regState", async () => {
    const p = transport.load("demo", MANIFEST, "export const activate = () => {};");
    const sent = channel.last();
    expect(sent.type).toBe("load");
    expect(sent.manifest).toEqual(MANIFEST);
    transport.onMessage(JSON.stringify({ type: "loaded", id: sent.id, regState: REG_STATE }));
    await expect(p).resolves.toEqual(REG_STATE);
  });

  it("rejects invoke on an error reply", async () => {
    const p = transport.invoke("demo", "acquisition", "status", []);
    const sent = channel.last();
    transport.onMessage(JSON.stringify({ type: "invokeResult", id: sent.id, error: "boom" }));
    await expect(p).rejects.toThrow("boom");
  });

  it("rejects load on an error reply", async () => {
    const p = transport.load("demo", MANIFEST, "code");
    const sent = channel.last();
    transport.onMessage(JSON.stringify({ type: "loaded", id: sent.id, error: "activate failed" }));
    await expect(p).rejects.toThrow("activate failed");
  });

  it("rejects invoke after the timeout elapses", async () => {
    vi.useFakeTimers();
    try {
      const p = transport.invoke("demo", "acquisition", "status", []);
      const assertion = expect(p).rejects.toThrow(/timed out/i);
      vi.advanceTimersByTime(60);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("routes an inbound hostCall to the handler and posts a correlated hostReply", async () => {
    const handler = vi.fn(async (pluginId: string, name: string, args: unknown[]) => {
      expect(pluginId).toBe("demo");
      expect(name).toBe("storageGet");
      expect(args).toEqual(["k"]);
      return "v";
    });
    transport.setHostCallHandler(handler);
    transport.onMessage(
      JSON.stringify({
        type: "hostCall",
        id: 7,
        pluginId: "demo",
        name: "storageGet",
        args: ["k"],
      }),
    );
    // Let the async handler settle and post the reply.
    await vi.waitFor(() => {
      expect(channel.last()).toMatchObject({ type: "hostReply", id: 7, value: "v" });
    });
    expect(handler).toHaveBeenCalledOnce();
  });

  it("posts a hostReply with error when the handler rejects", async () => {
    transport.setHostCallHandler(async () => {
      throw new Error("no access");
    });
    transport.onMessage(
      JSON.stringify({ type: "hostCall", id: 9, pluginId: "demo", name: "netFetch", args: [] }),
    );
    await vi.waitFor(() => {
      expect(channel.last()).toMatchObject({ type: "hostReply", id: 9, error: "no access" });
    });
  });

  it("emit posts an emit message (no reply expected)", () => {
    transport.emit("demo", "trackStarted", { track: { title: "x" } });
    expect(channel.last()).toMatchObject({
      type: "emit",
      pluginId: "demo",
      event: "trackStarted",
    });
  });

  it("dispose posts a dispose message", () => {
    transport.dispose("demo");
    expect(channel.last()).toMatchObject({ type: "dispose", pluginId: "demo" });
  });

  it("reset rejects all in-flight requests", async () => {
    const a = transport.invoke("demo", "acquisition", "status", []);
    const b = transport.load("demo", MANIFEST, "code");
    transport.reset();
    await expect(a).rejects.toThrow(/reset/i);
    await expect(b).rejects.toThrow(/reset/i);
  });
});
