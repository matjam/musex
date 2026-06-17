/**
 * Adapts a fetch-shaped function (ctx.fetch or ctx.net.client(...)) into the
 * LidarrClient's minimal HttpFn. TLS control (self-signed certs) now lives in
 * the host's ctx.net capability, so this plugin no longer imports node:*.
 */
import type { HttpFn } from "./client.js";

export function httpFnFrom(f: typeof fetch): HttpFn {
  return async (url, init) => {
    const res = await f(url, init);
    return { ok: res.ok, status: res.status, text: () => res.text() };
  };
}
