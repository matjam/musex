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

export class StreamProxy {
  /** serverId -> live endpoint, populated when a server is connected/selected. */
  private readonly endpoints = new Map<string, ServerEndpoint>();
  private server: http.Server | null = null;
  private port = 0;

  /** Register the connection endpoint for a server by its machine identifier.
   *  Called lazily on first stream resolution for that server. */
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

  baseUrl(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  /** Full token-free art URL for the renderer (token injected here on fetch). */
  artUrl(serverId: string, thumb: string | undefined): string | undefined {
    return thumb ? `${this.baseUrl()}/${serverId}${thumb}` : undefined;
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
    return { url: `${this.baseUrl()}/${track.serverId}${path}`, kind };
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Range");
    res.setHeader("Access-Control-Expose-Headers", "Accept-Ranges, Content-Range, Content-Length");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const reqUrl = new URL(req.url ?? "/", "http://127.0.0.1");
    const segments = reqUrl.pathname.replace(/^\//, "").split("/");
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
    upstream.search = reqUrl.search;
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
