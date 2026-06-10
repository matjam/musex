/**
 * HttpFn transports for the Lidarr client.
 *
 * - fetchTransport: global fetch — the default path.
 * - createNodeTransport: node:https / node:http chosen by URL protocol.
 *   Global fetch cannot relax TLS verification per-request, so the
 *   "Allow self-signed certificates" toggle routes through node:https with
 *   `rejectUnauthorized: false` (only when the toggle is on). No redirect
 *   handling — the Lidarr API doesn't redirect.
 */
import http from "node:http";
import https from "node:https";
import type { HttpFn, HttpResponse } from "./client.js";

export const fetchTransport: HttpFn = async (url, init) => {
  const res = await fetch(url, init);
  return { ok: res.ok, status: res.status, text: () => res.text() };
};

export function createNodeTransport(opts: { allowSelfSigned: boolean }): HttpFn {
  return (url, init) =>
    new Promise<HttpResponse>((resolve, reject) => {
      const onResponse = (res: http.IncomingMessage) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("error", reject);
        res.on("end", () => {
          const status = res.statusCode ?? 0;
          const body = Buffer.concat(chunks).toString("utf8");
          resolve({ ok: status >= 200 && status < 300, status, text: async () => body });
        });
      };
      const req =
        new URL(url).protocol === "https:"
          ? https.request(
              url,
              {
                method: init.method,
                headers: init.headers,
                rejectUnauthorized: !opts.allowSelfSigned,
              },
              onResponse,
            )
          : http.request(url, { method: init.method, headers: init.headers }, onResponse);
      req.on("error", reject);
      if (init.body !== undefined) req.write(init.body);
      req.end();
    });
}
