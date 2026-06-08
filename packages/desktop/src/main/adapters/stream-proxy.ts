import { randomBytes } from "node:crypto";
import http from "node:http";
import https from "node:https";
import type { AddressInfo } from "node:net";
import type { StreamRef, Track } from "@musex/core";
import { chooseStreamKind } from "../../logic/stream-kind.js";

/** Per-server connection info needed to fulfil a proxied stream request. */
export interface ServerEndpoint {
  baseUrl: string; // e.g. http://192.168.1.10:32400
  token: string; // per-server access token
}

/**
 * Localhost HTTP proxy that streams Plex media to the renderer with the Plex
 * token injected server-side (so the token never reaches the renderer).
 *
 * Because this is an authenticated, token-injecting service on loopback, it is
 * hardened against the classic localhost-proxy attacks:
 *  - a per-launch random secret is embedded in the URL PATH (not a header — media
 *    elements / <img> can't set headers; not a query param — HLS relative segments
 *    would drop it). Requests without the exact secret get 403.
 *  - the Host header must be the loopback literal `127.0.0.1:<port>`, defeating
 *    DNS-rebinding (a rebound hostname presents a different Host).
 *  - CORS reflects the renderer's Origin only AFTER those checks pass — never `*`.
 * Only the main process knows the secret; it bakes it into the URLs it hands the
 * renderer via IPC (resolve / artUrl).
 */
export class StreamProxy {
  /** serverId -> live endpoint, populated when a server is connected/selected. */
  private readonly endpoints = new Map<string, ServerEndpoint>();
  private server: http.Server | null = null;
  private port = 0;
  /** Regenerated every launch; gates all proxy access. */
  private readonly secret = randomBytes(32).toString("hex");

  /** Register the connection endpoint for a server by its machine identifier. */
  registerServer(serverId: string, endpoint: ServerEndpoint): void {
    this.endpoints.set(serverId, endpoint);
  }

  /** Start the localhost proxy. Call once in app.whenReady before creating the window. */
  async start(): Promise<void> {
    if (this.server) return;
    const server = http.createServer((req, res) => this.handle(req, res));
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        this.port = (server.address() as AddressInfo).port;
        resolve();
      });
    });
  }

  private baseUrl(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  /** Build a renderer-facing URL: http://127.0.0.1:<port>/<secret>/<serverId><plexPath>.
   *  The secret is a path segment so it survives HLS relative-segment resolution. */
  private mediaUrl(serverId: string, plexPathWithQuery: string): string {
    return `${this.baseUrl()}/${this.secret}/${serverId}${plexPathWithQuery}`;
  }

  /** Full token-free art URL for the renderer (token injected here on fetch). */
  artUrl(serverId: string, thumb: string | undefined): string | undefined {
    return thumb ? this.mediaUrl(serverId, thumb) : undefined;
  }

  /** Resolve a track to a playable URL + kind. */
  resolve(track: Track): StreamRef {
    const kind = chooseStreamKind(track.media.audioCodec);
    const path =
      kind === "direct"
        ? track.media.partKey
        : `/music/:/transcode/universal/start.m3u8?path=${encodeURIComponent(
            `/library/metadata/${track.id}`,
          )}&protocol=hls&directStreamAudio=1`;
    return { url: this.mediaUrl(track.serverId, path), kind };
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    // DNS-rebinding defense: only accept the loopback literal we listen on.
    if (req.headers.host !== `127.0.0.1:${this.port}`) {
      res.writeHead(403);
      res.end("forbidden host");
      return;
    }

    const reqUrl = new URL(req.url ?? "/", `http://127.0.0.1:${this.port}`);
    const segments = reqUrl.pathname.replace(/^\//, "").split("/");
    // First path segment is the per-launch secret; reject anything without it.
    const token = segments.shift() ?? "";
    if (token !== this.secret) {
      res.writeHead(403);
      res.end("forbidden");
      return;
    }

    // Authenticated: reflect the renderer's origin for the Web Audio XHR (never `*`).
    const origin = req.headers.origin;
    if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }
    res.setHeader("Access-Control-Allow-Headers", "Range");
    res.setHeader("Access-Control-Expose-Headers", "Accept-Ranges, Content-Range, Content-Length");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const serverId = segments.shift() ?? "";
    const plexPath = `/${segments.join("/")}`;
    const endpoint = this.endpoints.get(serverId);
    if (!endpoint) {
      res.writeHead(404);
      res.end("unknown server");
      return;
    }

    const upstream = new URL(endpoint.baseUrl);
    upstream.pathname = plexPath;
    upstream.search = reqUrl.search; // forward Plex query params (secret was in the path, not here)
    upstream.searchParams.set("X-Plex-Token", endpoint.token);

    const client = upstream.protocol === "https:" ? https : http;
    const headers: http.OutgoingHttpHeaders = {};
    if (req.headers.range) headers.Range = req.headers.range;

    const upstreamReq = client.request(upstream, { method: "GET", headers }, (upstreamRes) => {
      const h: http.OutgoingHttpHeaders = {};
      for (const k of ["content-type", "content-length", "content-range", "accept-ranges"]) {
        const v = upstreamRes.headers[k];
        if (v) h[k] = v;
      }
      res.writeHead(upstreamRes.statusCode ?? 502, h);
      upstreamRes.pipe(res);
    });
    upstreamReq.on("error", (err) => {
      console.error(`[musex stream proxy] ${plexPath} failed:`, err);
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
    // If the renderer aborts (track change/seek), stop the upstream request.
    req.on("close", () => upstreamReq.destroy());
    upstreamReq.end();
  }
}
