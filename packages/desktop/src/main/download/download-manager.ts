import { randomUUID } from "node:crypto";
import {
  buildHlsStartUrl,
  type DownloadJob,
  type DownloadRecord,
  parseHlsMaster,
  parseHlsMedia,
  type StorageQuality,
  stopSessionUrl,
  TRANSCODE_PROFILE_EXTRA,
} from "@musex/core";
import type { DownloadIndex } from "../adapters/download-index.js";
import type { DownloadStore, StoreWriter } from "../adapters/download-store.js";

export interface DownloadProgressEvent {
  key: string;
  state: DownloadRecord["state"];
  bytes: number;
  error?: string;
}
export interface DownloadManagerDeps {
  store: DownloadStore;
  index: DownloadIndex;
  fetch: typeof fetch;
  endpoint: (serverId: string) => Promise<{ baseUrl: string; token: string }>;
  clientId: string;
  getQuality: () => StorageQuality;
  onProgress: (e: DownloadProgressEvent) => void;
}

/** Poll cadence + cap while the Plex transcoder catches up producing segments. */
const SEGMENT_RETRY_DELAY_MS = 700;
const SEGMENT_RETRY_ATTEMPTS = 60;

export class DownloadManager {
  private queue: DownloadJob[] = [];
  private running = false;
  private idle: Promise<void> = Promise.resolve();
  private idleResolve: (() => void) | null = null;

  constructor(private readonly deps: DownloadManagerDeps) {}

  async enqueue(jobs: DownloadJob[]): Promise<void> {
    for (const j of jobs) {
      if (await this.deps.store.has(j.key)) continue;
      this.queue.push(j);
      this.record(j, "queued", 0);
    }
    this.pump();
  }

  /** Test/shutdown helper: resolves when the queue has drained. */
  drain(): Promise<void> {
    return this.idle;
  }

  private record(
    job: DownloadJob,
    state: DownloadRecord["state"],
    bytes: number,
    error?: string,
  ): void {
    const rec: DownloadRecord = {
      key: job.key,
      serverId: job.serverId,
      plexPath: job.plexPath,
      trackId: job.trackId,
      format: this.deps.getQuality().mode === "aac" ? "aac" : "original",
      state,
      bytes,
      addedAt: this.deps.index.get(job.key)?.addedAt ?? Date.now(),
      error,
      meta: job.meta,
    };
    this.deps.index.upsert(rec);
    this.deps.onProgress({ key: job.key, state, bytes, error });
  }

  private pump(): void {
    if (this.running) return;
    this.running = true;
    this.idle = new Promise((r) => {
      this.idleResolve = r;
    });
    void this.loop();
  }

  private async loop(): Promise<void> {
    while (this.queue.length) {
      const job = this.queue.shift()!;
      await this.runJob(job);
    }
    this.running = false;
    this.idleResolve?.();
  }

  private async runJob(job: DownloadJob): Promise<void> {
    this.record(job, "downloading", 0);
    const quality = this.deps.getQuality();
    const ep = await this.deps.endpoint(job.serverId);
    if (quality.mode === "aac") {
      await this.runHlsJob(job, quality, ep);
    } else {
      await this.runOriginalJob(job, ep);
    }
  }

  /** Direct-play the original file: single GET → arrayBuffer → validated write. */
  private async runOriginalJob(
    job: DownloadJob,
    ep: { baseUrl: string; token: string },
  ): Promise<void> {
    const url = `${ep.baseUrl}${job.plexPath}${job.plexPath.includes("?") ? "&" : "?"}X-Plex-Token=${encodeURIComponent(ep.token)}`;
    try {
      const res = await this.deps.fetch(url);
      if (!res.ok) {
        this.record(job, "failed", 0, `status ${res.status}`);
        return;
      }
      const buf = new Uint8Array(await res.arrayBuffer());

      // Validate the response body before committing to disk.
      if (buf.byteLength === 0) {
        this.record(job, "failed", 0, "empty body");
        return;
      }
      const contentLength = res.headers.get("content-length");
      if (contentLength !== null) {
        const expected = Number(contentLength);
        if (!Number.isNaN(expected) && buf.byteLength !== expected) {
          this.record(job, "failed", 0, `truncated: got ${buf.byteLength} of ${expected} bytes`);
          return;
        }
      }
      const contentType = res.headers.get("content-type");
      if (contentType?.startsWith("text/")) {
        this.record(job, "failed", 0, `non-audio content-type: ${contentType}`);
        return;
      }

      const w = this.deps.store.beginWrite(job.key);
      w.stream.write(Buffer.from(buf));
      w.stream.end();
      await w.commit();
      this.record(job, "downloaded", buf.byteLength);
    } catch (e) {
      this.record(job, "failed", 0, e instanceof Error ? e.message : String(e));
    }
  }

  /**
   * Transcode via Plex HLS and stitch the segments into one AAC file.
   *
   * Flow (confirmed by spike): GET start.m3u8 with the profile header → master
   * playlist → resolve the variant URI against the start URL and GET it →
   * media playlist → for each segment resolve it against the media URL and GET
   * it (retrying while the transcoder catches up), streaming each segment to
   * disk as it arrives. `#EXT-X-ENDLIST` means the playlist is complete; a
   * playlist without it means the transcode is still producing and we must not
   * publish a partial file. The token rides as a header on every HLS request
   * (the resolved variant/segment URLs carry no token query).
   */
  private async runHlsJob(
    job: DownloadJob,
    quality: StorageQuality,
    ep: { baseUrl: string; token: string },
  ): Promise<void> {
    const session = randomUUID();
    const startUrl = buildHlsStartUrl({
      baseUrl: ep.baseUrl,
      token: ep.token,
      clientId: this.deps.clientId,
      session,
      trackId: job.trackId,
      bitrateKbps: quality.bitrateKbps,
    });
    const hlsHeaders = {
      "X-Plex-Token": ep.token,
      "X-Plex-Client-Profile-Extra": TRANSCODE_PROFILE_EXTRA,
    };

    let w: StoreWriter | null = null;
    try {
      // 1. Master (or already-media) playlist.
      const startRes = await this.deps.fetch(startUrl, { headers: hlsHeaders });
      if (!startRes.ok) {
        this.record(job, "failed", 0, `hls start ${startRes.status}`);
        return;
      }
      const startText = await startRes.text();

      // 2. Resolve to the media playlist.
      const variant = parseHlsMaster(startText);
      let mediaUrl: string;
      let mediaText: string;
      if (variant) {
        mediaUrl = new URL(variant, startUrl).toString();
        const mediaRes = await this.deps.fetch(mediaUrl, { headers: hlsHeaders });
        if (!mediaRes.ok) {
          this.record(job, "failed", 0, `hls media ${mediaRes.status}`);
          return;
        }
        mediaText = await mediaRes.text();
      } else {
        mediaUrl = startUrl;
        mediaText = startText;
      }

      // 3. Parse segments + completeness.
      const { segments, ended } = parseHlsMedia(mediaText);
      if (segments.length === 0) {
        this.record(job, "failed", 0, "hls playlist had no segments");
        return;
      }

      // 4. Stream each segment to disk incrementally (never buffer the whole file).
      w = this.deps.store.beginWrite(job.key);
      let total = 0;
      for (const seg of segments) {
        const segUrl = new URL(seg.uri, mediaUrl).toString();
        const bytes = await this.fetchSegment(segUrl, hlsHeaders);
        if (bytes === null) {
          await w.abort();
          w = null;
          this.record(job, "failed", 0, `hls segment never became ready: ${seg.uri}`);
          return;
        }
        w.stream.write(Buffer.from(bytes));
        total += bytes.byteLength;
      }

      // 5. Only publish when the playlist is complete.
      if (!ended) {
        await w.abort();
        w = null;
        this.record(job, "failed", 0, "incomplete playlist (no ENDLIST)");
        return;
      }
      w.stream.end();
      await w.commit();
      w = null;
      this.record(job, "downloaded", total);
    } catch (e) {
      if (w) await w.abort();
      this.record(job, "failed", 0, e instanceof Error ? e.message : String(e));
    } finally {
      // Best-effort: free the Plex transcode session. Uses the injected fetch
      // (same seam as the download) so a custom client — e.g. self-signed TLS —
      // applies to the stop call too.
      await this.deps
        .fetch(
          stopSessionUrl({
            baseUrl: ep.baseUrl,
            token: ep.token,
            clientId: this.deps.clientId,
            session,
          }),
        )
        .catch(() => {});
    }
  }

  /**
   * Fetch one HLS segment, retrying while the transcoder catches up. Returns the
   * bytes on success, or null if the segment never became ready within the cap.
   */
  private async fetchSegment(
    url: string,
    headers: Record<string, string>,
  ): Promise<Uint8Array | null> {
    for (let attempt = 0; attempt < SEGMENT_RETRY_ATTEMPTS; attempt++) {
      const res = await this.deps.fetch(url, { headers });
      if (res.ok) {
        const bytes = new Uint8Array(await res.arrayBuffer());
        if (bytes.byteLength > 0) return bytes;
      }
      await delay(SEGMENT_RETRY_DELAY_MS);
    }
    return null;
  }

  async removeDownload(key: string): Promise<void> {
    await this.deps.store.remove(key);
    this.deps.index.remove(key);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
