/**
 * Tests for SandboxContext (quickjs-host.ts).
 *
 * Key regression: a guest module that awaits TWO sequential host calls must
 * resolve correctly. This is exactly the case that breaks the asyncify approach
 * (the spike's headline finding). If this test passes, we're using the correct
 * sync+newPromise model.
 */

import { describe, expect, it } from "vitest";
import { SandboxContext } from "./quickjs-host.js";

describe("SandboxContext", () => {
  it("creates and disposes without leaking handles", async () => {
    const sc = await SandboxContext.create();
    // Should not throw — QuickJS asserts on leaked handles
    sc.dispose();
  });

  it("can evaluate simple code", async () => {
    const sc = await SandboxContext.create();
    try {
      const result = await sc.evalSettle("1 + 2");
      expect(result).toBe(3);
    } finally {
      sc.dispose();
    }
  });

  it("installs preamble globals without error", async () => {
    const sc = await SandboxContext.create();
    try {
      sc.installPreamble();
      // Verify preamble globals are present
      const url = await sc.evalSettle(`typeof URLSearchParams`);
      expect(url).toBe("function");
      const clone = await sc.evalSettle(`typeof structuredClone`);
      expect(clone).toBe("function");
      const cons = await sc.evalSettle(`typeof console`);
      expect(cons).toBe("object");
      const st = await sc.evalSettle(`typeof setTimeout`);
      expect(st).toBe("function");
    } finally {
      sc.dispose();
    }
  });

  it("settles a guest Promise that resolves immediately", async () => {
    const sc = await SandboxContext.create();
    try {
      const result = await sc.evalSettle(`Promise.resolve(42)`);
      expect(result).toBe(42);
    } finally {
      sc.dispose();
    }
  });

  it("settles a guest Promise that rejects", async () => {
    const sc = await SandboxContext.create();
    try {
      await expect(sc.evalSettle(`Promise.reject(new Error("oops"))`)).rejects.toThrow();
    } finally {
      sc.dispose();
    }
  });

  it("KEY REGRESSION: guest module awaiting TWO sequential host async calls resolves correctly", async () => {
    // This is the exact case that breaks the asyncify/newAsyncContext approach.
    // The spike proved that sync context + newPromise handles this cleanly.
    const sc = await SandboxContext.create();
    try {
      const ctx = sc.context;

      // Simulate two async host capabilities that return guest Promises

      const hostObj = ctx.newObject();
      const callA = ctx.newFunction("callA", () => {
        const promise = ctx.newPromise();
        Promise.resolve("resultA").then((v) => {
          const h = ctx.newString(v);
          promise.resolve(h);
          h.dispose();
          promise.settled.then(() => ctx.runtime.executePendingJobs());
        });
        return promise.handle;
      });
      const callB = ctx.newFunction("callB", () => {
        const promise = ctx.newPromise();
        Promise.resolve("resultB").then((v) => {
          const h = ctx.newString(v);
          promise.resolve(h);
          h.dispose();
          promise.settled.then(() => ctx.runtime.executePendingJobs());
        });
        return promise.handle;
      });
      callA.consume((f) => ctx.setProp(hostObj, "callA", f));
      callB.consume((f) => ctx.setProp(hostObj, "callB", f));
      ctx.setProp(ctx.global, "__testHost", hostObj);
      hostObj.dispose();

      // Guest code awaits A then B sequentially
      const result = await sc.evalSettle(`
        (async () => {
          const a = await __testHost.callA();
          const b = await __testHost.callB();
          return { a, b };
        })()
      `);

      expect(result).toEqual({ a: "resultA", b: "resultB" });
    } finally {
      sc.dispose();
    }
  });

  it("loads an ESM module and returns exports", async () => {
    const sc = await SandboxContext.create();
    try {
      const code = `
        export const value = 42;
        export function activate(ctx) { return "activated"; }
      `;
      const exportsHandle = sc.loadModule(code, "toy.mjs");
      const ctx = sc.context;
      const valueProp = ctx.getProp(exportsHandle, "value");
      const value = ctx.getNumber(valueProp);
      valueProp.dispose();
      exportsHandle.dispose();
      expect(value).toBe(42);
    } finally {
      sc.dispose();
    }
  });

  it("dispose is idempotent", async () => {
    const sc = await SandboxContext.create();
    sc.dispose();
    // Second dispose should not throw
    sc.dispose();
  });

  it("URLSearchParams polyfill works", async () => {
    const sc = await SandboxContext.create();
    try {
      sc.installPreamble();
      const result = await sc.evalSettle(
        `new URLSearchParams({ foo: "bar", baz: "qux" }).toString()`,
      );
      expect(result).toBe("foo=bar&baz=qux");
    } finally {
      sc.dispose();
    }
  });

  it("structuredClone polyfill works", async () => {
    const sc = await SandboxContext.create();
    try {
      sc.installPreamble();
      const result = await sc.evalSettle(`structuredClone({ a: 1, b: [2, 3] })`);
      expect(result).toEqual({ a: 1, b: [2, 3] });
    } finally {
      sc.dispose();
    }
  });
});
