import type { StreamRef, Track } from "@musex/core";
import { net, protocol } from "electron";
import { chooseStreamKind } from "../../logic/stream-kind.js";
import { buildProxyUrl, parseProxyUrl } from "../../logic/stream-url.js";

/** Per-server connection info needed to fulfil a proxied stream request. */
export interface ServerEndpoint {
  baseUrl: string; // e.g. http://192.168.1.10:32400
  token: string; // per-server access token
}

export class StreamProxy {
  /** serverId -> live endpoint, populated when a server is connected/selected. */
  private readonly endpoints = new Map<string, ServerEndpoint>();

  /** Register the connection endpoint for a server by its machine identifier.
   *  Called lazily on first stream resolution for that server. */
  registerServer(serverId: string, endpoint: ServerEndpoint): void {
    this.endpoints.set(serverId, endpoint);
  }

  /** Called once in app.whenReady. */
  install(): void {
    // The renderer (localhost:5173 in dev) fetches these cross-origin. A GET with a
    // Range header is NOT a CORS-safelisted request, so Chromium sends a preflight
    // OPTIONS first — we must answer it with the right CORS headers and expose the
    // range headers, or the media/XHR load fails with net::ERR_FAILED.
    const CORS: Record<string, string> = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Range, Content-Type",
      "Access-Control-Expose-Headers": "Accept-Ranges, Content-Range, Content-Length, Content-Type",
    };

    protocol.handle("musex-stream", async (request) => {
      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: { ...CORS, "Access-Control-Max-Age": "86400" },
        });
      }

      const parsed = parseProxyUrl(request.url);
      if (!parsed) return new Response("bad request", { status: 400, headers: CORS });
      const endpoint = this.endpoints.get(parsed.serverId);
      if (!endpoint) return new Response("unknown server", { status: 404, headers: CORS });

      const upstream = new URL(endpoint.baseUrl);
      upstream.pathname = parsed.path;
      upstream.search = parsed.search;
      upstream.searchParams.set("X-Plex-Token", endpoint.token);

      const headers = new Headers();
      const range = request.headers.get("Range");
      if (range) headers.set("Range", range);

      try {
        const res = await net.fetch(upstream.toString(), { method: "GET", headers });
        // Buffer the upstream body fully, then return it complete. Passing
        // net.fetch's stream straight through protocol.handle truncated large
        // responses mid-stream (net::ERR_FAILED ~1.25MB in). Buffering trades
        // progressive start for reliability; gapless-5 downloads the whole file
        // for Web Audio anyway. TODO: piped localhost HTTP proxy for true streaming.
        const body = await res.arrayBuffer();
        console.log(
          `[musex stream proxy] ${request.method} ${parsed.path} range=${range ?? "none"} -> ${res.status} (${body.byteLength}B)`,
        );
        const out = new Headers(CORS);
        for (const h of ["content-type", "content-range", "accept-ranges"]) {
          const v = res.headers.get(h);
          if (v) out.set(h, v);
        }
        out.set("content-length", String(body.byteLength));
        return new Response(body, { status: res.status, headers: out });
      } catch (err) {
        console.error(
          `[musex stream proxy] ${parsed.path} (range=${range ?? "none"}) failed:`,
          err,
        );
        return new Response("upstream error", { status: 502, headers: CORS });
      }
    });
  }

  /** Resolve a track to a token-free proxy URL + kind, for the renderer engine. */
  resolve(track: Track): StreamRef {
    const kind = chooseStreamKind(track.media.audioCodec);
    const path =
      kind === "direct"
        ? track.media.partKey
        : `/music/:/transcode/universal/start.m3u8?path=${encodeURIComponent(
            `/library/metadata/${track.id}`,
          )}&protocol=hls&directStreamAudio=1`;
    return { url: buildProxyUrl(track.serverId, path), kind };
  }
}
