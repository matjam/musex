import { randomUUID } from "node:crypto";
import {
  buildTranscodeUrl,
  stopSessionUrl,
  type DownloadJob,
  type DownloadRecord,
  type StorageQuality,
} from "@musex/core";
import type { DownloadStore } from "../adapters/download-store.js";
import type { DownloadIndex } from "../adapters/download-index.js";

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

  private record(job: DownloadJob, state: DownloadRecord["state"], bytes: number, error?: string): void {
    const rec: DownloadRecord = {
      key: job.key,
      serverId: job.serverId,
      plexPath: job.plexPath,
      trackId: job.trackId,
      format: this.deps.getQuality().mode === "mp3" ? "mp3" : "original",
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
    const session = randomUUID();
    const url =
      quality.mode === "mp3"
        ? buildTranscodeUrl({
            baseUrl: ep.baseUrl,
            token: ep.token,
            clientId: this.deps.clientId,
            session,
            trackId: job.trackId,
            bitrateKbps: quality.bitrateKbps,
          })
        : `${ep.baseUrl}${job.plexPath}${job.plexPath.includes("?") ? "&" : "?"}X-Plex-Token=${encodeURIComponent(ep.token)}`;
    try {
      const res = await this.deps.fetch(url);
      if (!res.ok) {
        this.record(job, "failed", 0, `status ${res.status}`);
        return;
      }
      const buf = new Uint8Array(await res.arrayBuffer());
      const w = this.deps.store.beginWrite(job.key);
      w.stream.write(Buffer.from(buf));
      w.stream.end();
      await w.commit();
      this.record(job, "downloaded", buf.byteLength);
    } catch (e) {
      this.record(job, "failed", 0, e instanceof Error ? e.message : String(e));
    } finally {
      if (quality.mode === "mp3") {
        // Best-effort: free the Plex transcode session. Uses the injected fetch
        // (same seam as the download) so a custom client — e.g. self-signed TLS
        // — applies to the stop call too.
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
  }

  async removeDownload(key: string): Promise<void> {
    await this.deps.store.remove(key);
    this.deps.index.remove(key);
  }
}
