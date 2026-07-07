import {
  buildTransferJob,
  type DownloadJob,
  type DownloadRecord,
  type StorageQuality,
} from "@musex/core";
import type { DownloadIndex } from "./download-index";
import type { FileStore } from "./download-store";
import type { TransferEngine } from "./transfer-engine";

export interface DownloadProgress {
  key: string;
  state: DownloadRecord["state"];
  bytes: number;
  error?: string;
}

export interface DownloadManagerDeps {
  store: FileStore;
  index: DownloadIndex;
  /** Executes transfers (JS today; PR2 adds the native background engine). */
  engine: TransferEngine;
  endpoint: (serverId: string) => Promise<{ baseUrl: string; token: string }>;
  clientId: string;
  getQuality: () => StorageQuality;
  onProgress: (e: DownloadProgress) => void;
}

/** The download orchestrator: queue policy, dedupe, record bookkeeping. One
 *  job at a time (concurrency 1 — politeness alongside live streaming); the
 *  actual transfer runs behind the TransferEngine seam, its events mapped back
 *  onto index records. */
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
    const mode = this.deps.getQuality().mode;
    const rec: DownloadRecord = {
      key: job.key,
      serverId: job.serverId,
      plexPath: job.plexPath,
      trackId: job.trackId,
      format: mode === "aac" ? "aac" : "original",
      state,
      bytes,
      addedAt: this.deps.index.get(job.key)?.addedAt ?? Date.now(),
      error,
      meta: job.meta,
      origin: job.origin ?? "manual",
      // Integrity truth for original files only — an AAC transcode has no
      // predetermined size, so its record never carries one.
      expectedBytes: mode === "aac" ? undefined : job.expectedBytes,
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
    const transfer = buildTransferJob({
      job,
      quality,
      endpoint: ep,
      clientId: this.deps.clientId,
      destPath: this.deps.store.path(job.key),
      // Session id is caller-supplied (core stays Date.now-free).
      session: `${job.key}-${Date.now()}`,
    });
    // Map this job's engine events back onto records; resolve on the terminal one.
    await new Promise<void>((resolve) => {
      const off = this.deps.engine.onEvent((e) => {
        if (e.key !== job.key) return;
        if (e.kind === "progress") {
          this.deps.onProgress({ key: job.key, state: "downloading", bytes: e.bytes });
          return;
        }
        off();
        if (e.kind === "complete") void this.record(job, "downloaded", e.bytes).then(resolve);
        else void this.record(job, "failed", 0, e.message).then(resolve);
      });
      void this.deps.engine.submit([transfer]);
    });
  }

  async removeDownload(key: string): Promise<void> {
    this.deps.store.remove(key);
    await this.deps.index.remove(key);
  }
}
