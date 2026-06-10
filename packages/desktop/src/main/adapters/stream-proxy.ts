import { randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { open, stat } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import type { AddressInfo } from "node:net";
import type { StreamRef, Track } from "@musex/core";
import {
  cacheKey,
  contentTypeForPath,
  isArtPath,
  isCacheablePath,
  parseByteRange,
  sniffImageType,
} from "../../logic/cache.js";
import { validExternalImageUrl } from "../../logic/external-url.js";
import type { MediaCache } from "./media-cache.js";

const PREFETCH_DEPTH = 10;
/** Hard cap on a proxied external image body (covers are well under 1MB). */
const EXT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
/** Strictly sequential: the wanted list arrives priority-ordered (current track
 *  first, then lookahead), and one-at-a-time keeps prefetch from competing with
 *  the live playback stream for the Plex server's attention. */
const PREFETCH_CONCURRENCY = 1;

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

  private artCache: MediaCache | null = null;
  private artMaxBytes = 0;

  private readonly prefetchInflight = new Map<string, () => void>(); // key -> cancel

  /** Attach the always-on artwork cache (independent of the audio cache config). */
  setArtCache(cache: MediaCache, maxBytes: number): void {
    this.artCache = cache;
    this.artMaxBytes = maxBytes;
  }

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

  /** Bake a proxy URL for a plugin-supplied external image (e.g. last.fm album
   *  covers). https-only; anything else returns undefined (caller drops it). */
  externalArtUrl(remoteUrl: string | undefined): string | undefined {
    const valid = validExternalImageUrl(remoteUrl);
    return valid
      ? `${this.baseUrl()}/${this.secret}/ext?u=${encodeURIComponent(valid)}`
      : undefined;
  }

  resolve(track: Track): StreamRef {
    // mpv decodes every codec Plex can store, so everything direct-plays the
    // original file — no Plex transcode path needed.
    return { url: this.mediaUrl(track.serverId, track.media.partKey), kind: "direct" };
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

    // External-image branch (`/{secret}/ext?u=<https url>`): plugin-supplied
    // artwork (e.g. last.fm covers). Sits AFTER all security checks. NEVER
    // touches this.endpoints and NEVER attaches the Plex token — it is a plain
    // https fetch of a public image, cached in the always-on art cache.
    if (segments[0] === "ext") {
      await this.handleExternalArt(req, res, reqUrl);
      return;
    }

    const serverId = segments.shift() ?? "";
    const plexPath = `/${segments.join("/")}`;

    const cfg = this.readCacheConfig?.();
    const cachingOn = !!(cfg?.enabled && this.cache && isCacheablePath(plexPath));
    const key = cachingOn ? cacheKey(serverId, plexPath) : null;

    // Art branch: always-on, immutable Cache-Control; sits AFTER all security checks.
    const art = isArtPath(plexPath);
    if (art && this.artCache) {
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      const akey = cacheKey(serverId, plexPath);
      const hit = await this.artCache.pathIfPresent(akey);
      if (hit) {
        const head = await this.readHead(hit, 12);
        await this.serveFromFile(req, res, hit, sniffImageType(head));
        return;
      }
    }

    // Serve from disk if we have a complete copy (works for full + range, even offline).
    if (cachingOn && this.cache && key) {
      const hit = await this.cache.pathIfPresent(key);
      if (hit) {
        await this.serveFromFile(req, res, hit, contentTypeForPath(plexPath));
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

    // Only the full-file GET (no Range) populates the audio cache; partials are not cached.
    // Art paths always use the art cache (full GET; no Range on art).
    const writer =
      art && this.artCache
        ? this.artCache.beginWrite(cacheKey(serverId, plexPath), this.artMaxBytes)
        : cachingOn && this.cache && key && !req.headers.range
          ? this.cache.beginWrite(key, cfg?.maxBytes ?? 0)
          : null;

    // Cache writing is decoupled from the client response: the client pipe
    // governs upstream backpressure, while cache writes are best-effort — a slow
    // disk can never stall playback. finishCache is idempotent.
    let cacheOpen = writer !== null;
    const finishCache = (commit: boolean): void => {
      if (!writer || !cacheOpen) return;
      cacheOpen = false;
      (commit ? writer.commit() : writer.abort()).catch((e) =>
        console.error("[musex cache] finalize error:", e),
      );
    };

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
        // The client pipe drives upstream backpressure; the cache copy is a
        // decoupled, guarded best-effort write — so a slow disk never stalls
        // playback, and a late chunk after an abort can't write to a destroyed
        // stream (the prior ERR_STREAM_DESTROYED).
        upstreamRes.pipe(res);
        upstreamRes.on("data", (chunk: Buffer) => {
          written += chunk.length;
          if (cacheOpen && writer && !writer.stream.destroyed) writer.stream.write(chunk);
        });
        upstreamRes.on("end", () => {
          // Commit only a fully-received body (upstreamRes.complete covers the
          // no-Content-Length/chunked case) with a matching byte count; else discard.
          const lengthOk = !Number.isFinite(expected) || expected <= 0 || written === expected;
          finishCache(upstreamRes.complete && lengthOk);
        });
        upstreamRes.on("error", () => finishCache(false));
      } else {
        finishCache(false); // unexpected status (e.g. 206) -> don't cache
        upstreamRes.pipe(res);
      }
    });
    upstreamReq.on("error", (err) => {
      console.error(`[musex stream proxy] ${plexPath} failed:`, err);
      finishCache(false);
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
      finishCache(false);
    });
    upstreamReq.end();
  }

  /** Fetch + serve a plugin-supplied external image through the art cache.
   *  Security posture: the caller has already verified secret + Host; the URL
   *  must be https (no Plex token is ever attached, no endpoint lookup); the
   *  body is buffered with a hard 5MB cap (covers are <1MB). Cached entries
   *  are served from disk on later loads — including offline. */
  private async handleExternalArt(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    reqUrl: URL,
  ): Promise<void> {
    const remote = validExternalImageUrl(reqUrl.searchParams.get("u"));
    if (!remote) {
      res.writeHead(400);
      res.end("bad external url");
      return;
    }
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");

    const key = cacheKey("ext", remote);
    if (this.artCache) {
      const hit = await this.artCache.pathIfPresent(key);
      if (hit) {
        const head = await this.readHead(hit, 12);
        await this.serveFromFile(req, res, hit, sniffImageType(head));
        return;
      }
    }

    let upstream: Response;
    try {
      upstream = await fetch(remote); // global fetch: follows redirects, https enforced above
    } catch (err) {
      console.error(`[musex stream proxy] external image fetch failed for ${remote}:`, err);
      res.writeHead(502);
      res.end();
      return;
    }
    const contentType = upstream.headers.get("content-type") ?? "";
    const declaredLength = Number(upstream.headers.get("content-length") ?? "");
    if (
      !upstream.ok ||
      !contentType.startsWith("image/") ||
      (Number.isFinite(declaredLength) && declaredLength > EXT_IMAGE_MAX_BYTES)
    ) {
      // Cancel errors on an already-rejected upstream carry no signal — ignore.
      upstream.body?.cancel().catch(() => {});
      res.writeHead(502);
      res.end("bad upstream image");
      return;
    }
    let body: Buffer;
    try {
      body = Buffer.from(await upstream.arrayBuffer());
    } catch (err) {
      console.error(`[musex stream proxy] external image body failed for ${remote}:`, err);
      res.writeHead(502);
      res.end();
      return;
    }
    if (body.length === 0 || body.length > EXT_IMAGE_MAX_BYTES) {
      res.writeHead(502);
      res.end("bad upstream image");
      return;
    }

    // Best-effort cache write — a failed commit must never fail the response.
    if (this.artCache) {
      const writer = this.artCache.beginWrite(key, this.artMaxBytes);
      writer.stream.write(body);
      writer
        .commit()
        .catch((e) => console.error("[musex art cache] external image commit failed:", e));
    }

    res.writeHead(200, { "Content-Type": contentType, "Content-Length": String(body.length) });
    res.end(req.method === "HEAD" ? undefined : body);
  }

  private cacheFromUpstream(
    serverId: string,
    plexPath: string,
    key: string,
    maxBytes: number,
    onDone: () => void,
  ): () => void {
    const endpoint = this.endpoints.get(serverId);
    if (!endpoint || !this.cache) {
      onDone();
      return () => {};
    }
    const upstream = new URL(endpoint.baseUrl);
    upstream.pathname = plexPath;
    upstream.searchParams.set("X-Plex-Token", endpoint.token);
    const client = upstream.protocol === "https:" ? https : http;
    const writer = this.cache.beginWrite(key, maxBytes);
    let open = true;
    let finished = false;
    const finalize = (commit: boolean) => {
      if (open) {
        open = false;
        (commit ? writer.commit() : writer.abort()).catch((e) =>
          console.error("[musex prefetch] finalize error:", e),
        );
      }
      if (!finished) {
        finished = true;
        onDone();
      }
    };
    const req = client.request(upstream, { method: "GET" }, (res) => {
      if (res.statusCode !== 200) {
        res.resume(); // drain
        finalize(false);
        return;
      }
      const expected = Number(res.headers["content-length"] ?? "");
      let written = 0;
      res.on("data", (chunk: Buffer) => {
        written += chunk.length;
        if (open && !writer.stream.destroyed) writer.stream.write(chunk);
      });
      res.on("end", () => {
        const lengthOk = !Number.isFinite(expected) || expected <= 0 || written === expected;
        finalize(res.complete && lengthOk);
      });
      res.on("error", () => finalize(false));
    });
    req.on("error", () => finalize(false));
    req.end();
    return () => {
      req.destroy();
      finalize(false);
    };
  }

  /** Warm the on-disk cache for the upcoming direct-play tracks (cacheable paths).
   *  Cancels in-flight prefetches no longer wanted; starts up to the concurrency
   *  limit; skips already-cached / in-flight. No-op when caching is disabled. */
  prefetch(upcoming: { serverId: string; plexPath: string }[]): void {
    const cfg = this.readCacheConfig?.();
    if (!cfg?.enabled || !this.cache) {
      this.cancelAllPrefetch();
      return;
    }
    const wanted = upcoming
      .filter((u) => isCacheablePath(u.plexPath))
      .slice(0, PREFETCH_DEPTH + 1) // current track + lookahead
      .map((u) => ({ ...u, key: cacheKey(u.serverId, u.plexPath) }));
    const wantedKeys = new Set(wanted.map((w) => w.key));
    // Cancel in-flight prefetches that are no longer wanted.
    for (const [k, cancel] of this.prefetchInflight) {
      if (!wantedKeys.has(k)) {
        cancel();
        this.prefetchInflight.delete(k);
      }
    }
    void this.pumpPrefetch(wanted, cfg.maxBytes);
  }

  private async pumpPrefetch(
    wanted: { serverId: string; plexPath: string; key: string }[],
    maxBytes: number,
  ): Promise<void> {
    for (const w of wanted) {
      if (this.prefetchInflight.size >= PREFETCH_CONCURRENCY) return;
      if (this.prefetchInflight.has(w.key)) continue;
      if (!this.cache) return;
      if (await this.cache.pathIfPresent(w.key)) continue; // already cached
      // Re-check capacity after the await (it may have filled).
      if (this.prefetchInflight.size >= PREFETCH_CONCURRENCY || this.prefetchInflight.has(w.key)) {
        continue;
      }
      const cancel = this.cacheFromUpstream(w.serverId, w.plexPath, w.key, maxBytes, () => {
        this.prefetchInflight.delete(w.key);
        void this.pumpPrefetch(wanted, maxBytes); // start the next one
      });
      this.prefetchInflight.set(w.key, cancel);
    }
  }

  private cancelAllPrefetch(): void {
    for (const cancel of this.prefetchInflight.values()) cancel();
    this.prefetchInflight.clear();
  }

  /** Read the first n bytes of a file (for image magic-byte sniffing). */
  private async readHead(filePath: string, n: number): Promise<Uint8Array> {
    const fh = await open(filePath);
    try {
      const buf = Buffer.alloc(n);
      const { bytesRead } = await fh.read(buf, 0, n, 0);
      return buf.subarray(0, bytesRead);
    } finally {
      await fh.close();
    }
  }

  /** Serve a complete cache file, honouring Range requests for seeking. */
  private async serveFromFile(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    filePath: string,
    contentType: string,
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
    res.setHeader("Content-Type", contentType);

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
