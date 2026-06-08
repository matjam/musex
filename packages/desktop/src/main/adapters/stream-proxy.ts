import { randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import type { AddressInfo } from "node:net";
import type { StreamRef, Track } from "@musex/core";
import {
  cacheKey,
  contentTypeForPath,
  isCacheablePath,
  parseByteRange,
} from "../../logic/cache.js";
import { chooseStreamKind } from "../../logic/stream-kind.js";
import type { MediaCache } from "./media-cache.js";

/** Per-server connection info needed to fulfil a proxied stream request. */
export interface ServerEndpoint {
  baseUrl: string; // e.g. http://192.168.1.10:32400
  token: string; // per-server access token
}

/** How the proxy reads live cache configuration on each request. */
export type CacheConfig = { enabled: boolean; maxBytes: number };

/**
 * Localhost HTTP proxy that streams Plex media to the renderer with the Plex
 * token injected server-side (so the token never reaches the renderer).
 *
 * Hardened against the classic localhost-proxy attacks:
 *  - a per-launch random secret is embedded in the URL PATH (not a header — media
 *    elements / <img> can't set headers; not a query param — HLS relative segments
 *    would drop it). Requests without the exact secret get 403.
 *  - the Host header must be the loopback literal `127.0.0.1:<port>`, defeating
 *    DNS-rebinding (a rebound hostname presents a different Host).
 *  - CORS reflects the renderer's Origin only AFTER those checks pass — never `*`.
 *
 * When a cache is configured and enabled, original media files (/library/parts/)
 * are written through to disk as they stream and served from disk on later plays.
 */
export class StreamProxy {
  private readonly endpoints = new Map<string, ServerEndpoint>();
  private server: http.Server | null = null;
  private port = 0;
  private readonly secret = randomBytes(32).toString("hex");

  private cache: MediaCache | null = null;
  private readCacheConfig: (() => CacheConfig) | null = null;

  registerServer(serverId: string, endpoint: ServerEndpoint): void {
    this.endpoints.set(serverId, endpoint);
  }

  /** Attach a media cache + a getter for live config (read fresh per request). */
  configureCache(cache: MediaCache, readConfig: () => CacheConfig): void {
    this.cache = cache;
    this.readCacheConfig = readConfig;
  }

  async start(): Promise<void> {
    if (this.server) return;
    const server = http.createServer((req, res) => {
      this.handle(req, res).catch((err) => {
        console.error("[musex stream proxy] handler error:", err);
        if (!res.headersSent) res.writeHead(500);
        res.end();
      });
    });
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

  private mediaUrl(serverId: string, plexPathWithQuery: string): string {
    return `${this.baseUrl()}/${this.secret}/${serverId}${plexPathWithQuery}`;
  }

  artUrl(serverId: string, thumb: string | undefined): string | undefined {
    return thumb ? this.mediaUrl(serverId, thumb) : undefined;
  }

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

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    // DNS-rebinding defense: only accept the loopback literal we listen on.
    if (req.headers.host !== `127.0.0.1:${this.port}`) {
      res.writeHead(403);
      res.end("forbidden host");
      return;
    }

    const reqUrl = new URL(req.url ?? "/", `http://127.0.0.1:${this.port}`);
    const segments = reqUrl.pathname.replace(/^\//, "").split("/");
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

    const cfg = this.readCacheConfig?.();
    const cachingOn = !!(cfg?.enabled && this.cache && isCacheablePath(plexPath));
    const key = cachingOn ? cacheKey(serverId, plexPath) : null;

    // Serve from disk if we have a complete copy (works for full + range, even offline).
    if (cachingOn && this.cache && key) {
      const hit = await this.cache.pathIfPresent(key);
      if (hit) {
        await this.serveFromFile(req, res, hit, plexPath);
        return;
      }
    }

    const endpoint = this.endpoints.get(serverId);
    if (!endpoint) {
      res.writeHead(404);
      res.end("unknown server");
      return;
    }

    const upstream = new URL(endpoint.baseUrl);
    upstream.pathname = plexPath;
    upstream.search = reqUrl.search; // forward Plex query params (secret was in the path)
    upstream.searchParams.set("X-Plex-Token", endpoint.token);

    const client = upstream.protocol === "https:" ? https : http;
    const headers: http.OutgoingHttpHeaders = {};
    if (req.headers.range) headers.Range = req.headers.range;

    // Only the full-file GET (no Range) populates the cache; partials are not cached.
    const writer =
      cachingOn && this.cache && key && !req.headers.range
        ? this.cache.beginWrite(key, cfg?.maxBytes ?? 0)
        : null;

    const upstreamReq = client.request(upstream, { method: "GET", headers }, (upstreamRes) => {
      const h: http.OutgoingHttpHeaders = {};
      for (const k of ["content-type", "content-length", "content-range", "accept-ranges"]) {
        const v = upstreamRes.headers[k];
        if (v) h[k] = v;
      }
      res.writeHead(upstreamRes.statusCode ?? 502, h);

      if (writer && upstreamRes.statusCode === 200) {
        const expected = Number(upstreamRes.headers["content-length"] ?? "");
        let written = 0;
        upstreamRes.on("data", (chunk: Buffer) => {
          written += chunk.length;
        });
        upstreamRes.pipe(res);
        // { end: false } so the writer (commit) owns the single end() and can
        // flush before publishing; we never end the cache file from the pipe.
        upstreamRes.pipe(writer.stream, { end: false });
        upstreamRes.on("end", () => {
          // Commit only when the upstream message was fully received
          // (upstreamRes.complete covers the no-Content-Length/chunked case) AND,
          // when a length is known, the byte count matches. Otherwise discard.
          const lengthOk = !Number.isFinite(expected) || expected <= 0 || written === expected;
          if (upstreamRes.complete && lengthOk) {
            writer.commit().catch((err) => console.error("[musex cache] commit error:", err));
          } else {
            writer.abort().catch((err) => console.error("[musex cache] abort error:", err));
          }
        });
        upstreamRes.on("error", () =>
          writer.abort().catch((err) => console.error("[musex cache] abort error:", err)),
        );
      } else {
        // Unexpected status (e.g. 206) -> don't cache.
        if (writer) writer.abort().catch((err) => console.error("[musex cache] abort error:", err));
        upstreamRes.pipe(res);
      }
    });
    upstreamReq.on("error", (err) => {
      console.error(`[musex stream proxy] ${plexPath} failed:`, err);
      if (writer) writer.abort().catch((e) => console.error("[musex cache] abort error:", e));
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
    // Renderer 'close' fires on normal completion too, so only treat it as an
    // abort when the response did NOT finish (genuine early disconnect / seek /
    // track change). On normal completion the upstream 'end' handler owns the
    // commit/abort decision.
    req.on("close", () => {
      if (res.writableFinished) return;
      upstreamReq.destroy();
      if (writer) writer.abort().catch((e) => console.error("[musex cache] abort error:", e));
    });
    upstreamReq.end();
  }

  /** Serve a complete cache file, honouring Range requests for seeking. */
  private async serveFromFile(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    filePath: string,
    plexPath: string,
  ): Promise<void> {
    let size: number;
    try {
      size = (await stat(filePath)).size;
    } catch {
      res.writeHead(404);
      res.end();
      return;
    }
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Content-Type", contentTypeForPath(plexPath));

    // A 0-byte entry should never exist post-commit, but guard against it:
    // createReadStream(..., { end: -1 }) would throw after headers were sent.
    if (size === 0) {
      res.writeHead(200, { "Content-Length": "0" });
      res.end();
      return;
    }

    const range = parseByteRange(req.headers.range, size);
    const pipeFile = (start: number, end: number, status: number) => {
      res.writeHead(status, {
        "Content-Length": String(end - start + 1),
        ...(status === 206 ? { "Content-Range": `bytes ${start}-${end}/${size}` } : {}),
      });
      if (req.method === "HEAD") {
        res.end();
        return;
      }
      const stream = createReadStream(filePath, { start, end });
      stream.on("error", (err) => {
        console.error(`[musex cache] read failed for ${filePath}:`, err);
        if (!res.headersSent) res.writeHead(500);
        res.end();
      });
      req.on("close", () => stream.destroy());
      stream.pipe(res);
    };

    if (range) {
      pipeFile(range.start, range.end, 206);
    } else {
      pipeFile(0, size - 1, 200);
    }
  }
}
