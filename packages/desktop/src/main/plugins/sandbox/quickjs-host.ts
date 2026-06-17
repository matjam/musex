/**
 * SandboxContext — a thin typed wrapper around a synchronous QuickJS runtime
 * and context. This is the core mechanism for running third-party plugins in
 * isolation.
 *
 * KEY DESIGN (ported from spike/quickjs-sandbox harness.mjs):
 *   - Uses a SYNC QuickJSContext + newPromise pattern. DO NOT use the asyncify
 *     / newAsyncContext approach — it corrupts the WASM heap on the second
 *     sequential awaited host call (verified in the spike).
 *   - Every host capability that is async returns a guest Promise which the
 *     host settles after the real async work completes.
 *   - Handle lifetime: every QuickJS handle MUST be disposed. Use `consume()`
 *     or explicit `.dispose()` calls; one leaked handle aborts on teardown.
 */

import type { QuickJSContext, QuickJSHandle, QuickJSRuntime } from "quickjs-emscripten";
import { getQuickJS, isFail } from "quickjs-emscripten";

/**
 * Marshalling helpers: host <-> guest pass JSON-serializable data only.
 */
export function toGuest(ctx: QuickJSContext, value: unknown): QuickJSHandle {
  if (value === undefined) return ctx.undefined;
  if (value === null) return ctx.null;
  const json = JSON.stringify(value);
  const strHandle = ctx.newString(json);
  const jsonObj = ctx.getProp(ctx.global, "JSON");
  const parse = ctx.getProp(jsonObj, "parse");
  const result = ctx.callFunction(parse, ctx.undefined, strHandle);
  strHandle.dispose();
  parse.dispose();
  jsonObj.dispose();
  return ctx.unwrapResult(result);
}

export function fromGuest(ctx: QuickJSContext, handle: QuickJSHandle): unknown {
  return ctx.dump(handle);
}

/**
 * SandboxContext wraps a QuickJSRuntime + QuickJSContext with helpers for:
 *   - installing the host preamble (timers, URL/URLSearchParams, console, structuredClone)
 *   - loading an ESM module
 *   - calling a guest function and driving its returned Promise to settlement
 *   - clean disposal (including flushing pending jobs so no GC objects leak)
 */
export class SandboxContext {
  private runtime!: QuickJSRuntime;
  private ctx!: QuickJSContext;
  private disposed = false;

  private constructor() {}

  static async create(): Promise<SandboxContext> {
    const QuickJS = await getQuickJS();
    const sc = new SandboxContext();
    sc.runtime = QuickJS.newRuntime();
    sc.ctx = sc.runtime.newContext();
    return sc;
  }

  get context(): QuickJSContext {
    return this.ctx;
  }

  get runtime_(): QuickJSRuntime {
    return this.runtime;
  }

  /**
   * Install the host preamble into the context globalThis.
   * Provides: setTimeout/clearTimeout/setInterval/clearInterval,
   *           URL/URLSearchParams, console, structuredClone.
   */
  installPreamble(): void {
    // Timers: setTimeout runs fn in next host microtask then drains guest jobs.
    this.ctx
      .newFunction("setTimeout", (fnHandle) => {
        const fn = fnHandle.dup();
        Promise.resolve().then(() => {
          const r = this.ctx.callFunction(fn, this.ctx.undefined);
          if (isFail(r)) r.error.dispose();
          else r.value.dispose();
          fn.dispose();
          this.runtime.executePendingJobs();
        });
        return this.ctx.newNumber(1);
      })
      .consume((fn) => this.ctx.setProp(this.ctx.global, "setTimeout", fn));

    this.ctx
      .newFunction("clearTimeout", () => this.ctx.undefined)
      .consume((fn) => this.ctx.setProp(this.ctx.global, "clearTimeout", fn));

    // setInterval / clearInterval: no-op (plugins should not busy-spin)
    this.ctx
      .newFunction("setInterval", () => this.ctx.newNumber(2))
      .consume((fn) => this.ctx.setProp(this.ctx.global, "setInterval", fn));

    this.ctx
      .newFunction("clearInterval", () => this.ctx.undefined)
      .consume((fn) => this.ctx.setProp(this.ctx.global, "clearInterval", fn));

    // URL, URLSearchParams, console, structuredClone via evalCode
    this.ctx
      .unwrapResult(
        this.ctx.evalCode(`
        // Minimal URL (covers the new URL(href) usage in plugins).
        globalThis.URL = class URL {
          constructor(href, base) {
            this.href = base ? new URL(href).href : href;
            const [protocol, rest] = this.href.split("://");
            this.protocol = protocol + ":";
            const [host, ...pathParts] = (rest || "").split("/");
            this.host = host;
            const [hostname, port] = host.split(":");
            this.hostname = hostname;
            this.port = port || "";
            this.pathname = "/" + pathParts.join("/").split("?")[0].split("#")[0];
            const qIdx = this.href.indexOf("?");
            const hIdx = this.href.indexOf("#");
            this.search = qIdx >= 0 ? this.href.slice(qIdx, hIdx >= 0 ? hIdx : undefined) : "";
            this.hash = hIdx >= 0 ? this.href.slice(hIdx) : "";
            this.searchParams = new URLSearchParams(this.search.slice(1));
            this.origin = this.protocol + "//" + this.host;
          }
          toString() { return this.href; }
        };

        // Minimal URLSearchParams (covers new URLSearchParams(obj|string).toString()).
        globalThis.URLSearchParams = class URLSearchParams {
          constructor(init) {
            this._p = [];
            if (init && typeof init === "object" && !Array.isArray(init)) {
              for (const k of Object.keys(init)) this._p.push([k, String(init[k])]);
            } else if (typeof init === "string") {
              for (const pair of init.replace(/^\\?/, "").split("&")) {
                if (!pair) continue;
                const i = pair.indexOf("=");
                const k = i < 0 ? pair : pair.slice(0, i);
                const v = i < 0 ? "" : pair.slice(i + 1);
                this._p.push([decodeURIComponent(k), decodeURIComponent(v)]);
              }
            }
          }
          append(k, v) { this._p.push([String(k), String(v)]); }
          get(k) { const f = this._p.find((e) => e[0] === k); return f ? f[1] : null; }
          toString() {
            return this._p.map(([k, v]) => encodeURIComponent(k) + "=" + encodeURIComponent(v)).join("&");
          }
        };

        // console shim -> globalThis.__hostLog (bridged after preamble).
        // If __hostLog is not yet set, fall back to a no-op.
        globalThis.console = {
          log: (...a) => (globalThis.__hostLog ?? (()=>{}))("[log] " + a.map(String).join(" ")),
          error: (...a) => (globalThis.__hostLog ?? (()=>{}))("[error] " + a.map(String).join(" ")),
          warn: (...a) => (globalThis.__hostLog ?? (()=>{}))("[warn] " + a.map(String).join(" ")),
          info: (...a) => (globalThis.__hostLog ?? (()=>{}))("[info] " + a.map(String).join(" ")),
        };

        // structuredClone via JSON round-trip (covers the musex core use-case).
        globalThis.structuredClone = (v) => JSON.parse(JSON.stringify(v));
      `),
      )
      .dispose();
  }

  /**
   * Load an ESM module from source code. Returns the module's exports handle.
   * The caller is responsible for disposing the returned handle.
   */
  loadModule(code: string, name: string): QuickJSHandle {
    const result = this.ctx.evalCode(code, name, { type: "module" });
    return this.ctx.unwrapResult(result);
  }

  /**
   * Call a guest function handle with args (JSON-serializable) and drive the
   * returned Promise to settlement via the settled callback pattern.
   *
   * This is the production equivalent of the harness's `evalSettle` + `settle`:
   *   - Guest Promises settled by host async ops (netFetch, storage, etc.): the
   *     `settled` callback fires after the host resolves the promise, then we
   *     drain pending guest jobs.
   *   - Guest Promises settled by guest microtasks alone (no host call): we pump
   *     `executePendingJobs()` directly.
   *
   * We interleave: pump guest jobs → yield to host event loop → re-check,
   * until settled. Max 1M iterations (no real plugin should ever hit this).
   */
  async callGuest(fnHandle: QuickJSHandle, args: unknown[]): Promise<unknown> {
    const argHandles = args.map((a) => toGuest(this.ctx, a));
    const resultHandle = this.ctx.callFunction(fnHandle, this.ctx.undefined, ...argHandles);
    for (const h of argHandles) h.dispose();

    const ph = this.ctx.unwrapResult(resultHandle);
    try {
      return await this.settlePromise(ph);
    } finally {
      try {
        ph.dispose();
      } catch {}
    }
  }

  /**
   * Evaluate guest code that returns a Promise, settle it, and return the result.
   * Convenience wrapper over callGuest when the code is an expression string.
   */
  async evalSettle(code: string): Promise<unknown> {
    const res = this.ctx.evalCode(code);
    const ph = this.ctx.unwrapResult(res);
    try {
      return await this.settlePromise(ph);
    } finally {
      // Always dispose the handle, even if settlePromise throws.
      // This prevents WASM heap leaks on rejection.
      try {
        ph.dispose();
      } catch {}
    }
  }

  /**
   * Settle a guest Promise handle to a host value.
   * Drives BOTH paths: pure guest microtask queue and host async ops.
   *
   * Uses getPromiseState + polling to drive both the guest microtask queue
   * (pure-guest synchronous path) and the host async path. The key is we
   * interleave pumping guest jobs with yielding to the host event loop so both
   * paths settle. We drain jobs after each yield.
   */
  async settlePromise(ph: QuickJSHandle): Promise<unknown> {
    let st = this.ctx.getPromiseState(ph);
    // getPromiseState returns fulfilled with notAPromise:true for non-promise values.
    // In this case, st.value IS the same handle as ph — do NOT dispose it here;
    // the caller's finally block (or explicit dispose) will handle ph's lifetime.
    if (st.type === "fulfilled" && st.notAPromise) {
      return fromGuest(this.ctx, st.value);
    }

    for (let i = 0; i < 1_000_000 && st.type === "pending"; i++) {
      this.runtime.executePendingJobs();
      st = this.ctx.getPromiseState(ph);
      if (st.type !== "pending") break;
      await new Promise<void>((res) => setImmediate(res)); // yield to host event loop
      this.runtime.executePendingJobs(); // drain again after host turn
      st = this.ctx.getPromiseState(ph);
    }

    if (st.type === "fulfilled") {
      const out = fromGuest(this.ctx, st.value);
      st.value.dispose();
      return out;
    }
    if (st.type === "rejected") {
      const errDump = fromGuest(this.ctx, st.error);
      st.error.dispose();
      // Drain pending jobs before throwing — a rejected promise may have queued
      // unhandled-rejection tracking jobs that must be flushed so QuickJS can
      // GC the promise object cleanly.
      this.runtime.executePendingJobs();
      throw new Error(`guest promise rejected: ${JSON.stringify(errDump)}`);
    }
    throw new Error("guest promise never settled (exceeded iteration limit)");
  }

  /**
   * Dispose the context and runtime, flushing pending jobs first.
   * After calling dispose(), this SandboxContext is unusable.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    try {
      this.runtime.executePendingJobs();
    } catch {
      // ignore — we're tearing down
    }
    this.ctx.dispose();
    this.runtime.dispose();
  }
}
