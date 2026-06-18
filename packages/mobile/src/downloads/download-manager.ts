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
import type { DownloadIndex } from "./download-index";
import type { FileStore, StoreWriter } from "./download-store";

export interface DownloadProgress {
  key: string;
  state: DownloadRecord["state"];
  bytes: number;
  error?: string;
}

export interface DownloadManagerDeps {
  store: FileStore;
  index: DownloadIndex;
  fetch: typeof fetch;
  endpoint: (serverId: string) => Promise<{ baseUrl: string; token: string }>;
  clientId: string;
  getQuality: () => StorageQuality;
  onProgress: (e: DownloadProgress) => void;
}

const SEGMENT_RETRY_DELAY_MS = 700;
const SEGMENT_RETRY_ATTEMPTS = 60;
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class DownloadManager {
  private queue: DownloadJob[] = [];
  private running = false;
  private idle: Promise<void> = Promise.resolve();
  private idleResolve: (() => void) | null = null;

  constructor(private readonly deps: DownloadManagerDeps) {}

  async enqueue(jobs: DownloadJob[]): Promise<void> {
    for (const j of jobs) {
      if (this.deps.store.has(j.key)) continue;
      this.queue.push(j);
      await this.record(j, "queued", 0);
    }
    this.pump();
  }

  drain(): Promise<void> {
    return this.idle;
  }

  private async record(
    job: DownloadJob,
    state: DownloadRecord["state"],
    bytes: number,
    error?: string,
  ): Promise<void> {
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
    await this.deps.index.upsert(rec);
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
    while (this.queue.length) await this.runJob(this.queue.shift()!);
    this.running = false;
    this.idleResolve?.();
  }

  private async runJob(job: DownloadJob): Promise<void> {
    await this.record(job, "downloading", 0);
    const quality = this.deps.getQuality();
    const ep = await this.deps.endpoint(job.serverId);
    if (quality.mode === "aac") await this.runHlsJob(job, quality, ep);
    else await this.runOriginalJob(job, ep);
  }

  private async runOriginalJob(
    job: DownloadJob,
    ep: { baseUrl: string; token: string },
  ): Promise<void> {
    const url = `${ep.baseUrl}${job.plexPath}${job.plexPath.includes("?") ? "&" : "?"}X-Plex-Token=${encodeURIComponent(ep.token)}`;
    try {
      const bytes = await this.deps.store.downloadUrl(job.key, url, (w) =>
        this.deps.onProgress({ key: job.key, state: "downloading", bytes: w }),
      );
      await this.record(job, "downloaded", bytes);
    } catch (e) {
      this.deps.store.remove(job.key);
      await this.record(job, "failed", 0, e instanceof Error ? e.message : String(e));
    }
  }

  private async runHlsJob(
    job: DownloadJob,
    quality: StorageQuality,
    ep: { baseUrl: string; token: string },
  ): Promise<void> {
    const session = `${job.key}-${Date.now()}`;
    const startUrl = buildHlsStartUrl({
      baseUrl: ep.baseUrl,
      token: ep.token,
      clientId: this.deps.clientId,
      session,
      trackId: job.trackId,
      bitrateKbps: quality.bitrateKbps,
    });
    const headers = {
      "X-Plex-Token": ep.token,
      "X-Plex-Client-Profile-Extra": TRANSCODE_PROFILE_EXTRA,
    };
    let w: StoreWriter | null = null;
    try {
      const startRes = await this.deps.fetch(startUrl, { headers });
      if (!startRes.ok) {
        await this.record(job, "failed", 0, `hls start ${startRes.status}`);
        return;
      }
      const startText = await startRes.text();
      const variant = parseHlsMaster(startText);
      let mediaUrl = startUrl;
      let mediaText = startText;
      if (variant) {
        mediaUrl = new URL(variant, startUrl).toString();
        const mediaRes = await this.deps.fetch(mediaUrl, { headers });
        if (!mediaRes.ok) {
          await this.record(job, "failed", 0, `hls media ${mediaRes.status}`);
          return;
        }
        mediaText = await mediaRes.text();
      }
      const { segments, ended } = parseHlsMedia(mediaText);
      if (segments.length === 0) {
        await this.record(job, "failed", 0, "no segments");
        return;
      }
      w = this.deps.store.beginWrite(job.key);
      let total = 0;
      for (const seg of segments) {
        const bytes = await this.fetchSegment(new URL(seg.uri, mediaUrl).toString(), headers);
        if (bytes === null) {
          await w.abort();
          w = null;
          await this.record(job, "failed", 0, `segment unavailable: ${seg.uri}`);
          return;
        }
        w.write(bytes);
        total += bytes.byteLength;
        this.deps.onProgress({ key: job.key, state: "downloading", bytes: total });
      }
      if (!ended) {
        await w.abort();
        w = null;
        await this.record(job, "failed", 0, "incomplete playlist (no ENDLIST)");
        return;
      }
      await w.commit();
      w = null;
      await this.record(job, "downloaded", total);
    } catch (e) {
      if (w) await w.abort();
      await this.record(job, "failed", 0, e instanceof Error ? e.message : String(e));
    } finally {
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

  private async fetchSegment(
    url: string,
    headers: Record<string, string>,
  ): Promise<Uint8Array | null> {
    for (let attempt = 0; attempt < SEGMENT_RETRY_ATTEMPTS; attempt++) {
      const res = await this.deps.fetch(url, { headers });
      if (res.ok) {
        const bytes = new Uint8Array(await res.arrayBuffer());
        if (bytes.byteLength > 0) return bytes;
      } else if (res.status !== 404 && res.status < 500) return null;
      await delay(SEGMENT_RETRY_DELAY_MS);
    }
    return null;
  }

  async removeDownload(key: string): Promise<void> {
    this.deps.store.remove(key);
    await this.deps.index.remove(key);
  }
}
