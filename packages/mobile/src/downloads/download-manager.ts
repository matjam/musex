import {
  buildTransferJob,
  type DownloadFormat,
  type DownloadJob,
  type DownloadRecord,
  isInFlight,
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

/** A queued download plus the quality mode pinned at enqueue time — a Settings
 *  quality toggle mid-lifecycle must not flip an already-recorded job's format
 *  against its transfer (or an already-committed file). */
interface QueueEntry {
  job: DownloadJob;
  format: DownloadFormat;
}

// Minimum interval between mid-flight record upserts per key. The index's own
// 600ms debounced persist handles disk; this just bounds in-memory churn.
const PROGRESS_UPSERT_MS = 500;

/** The download orchestrator: queue policy, dedupe, record bookkeeping. One
 *  job at a time (concurrency 1 — politeness alongside live streaming); the
 *  actual transfer runs behind the TransferEngine seam, its events mapped back
 *  onto index records. */
export class DownloadManager {
  private queue: QueueEntry[] = [];
  private running = false;
  private idle: Promise<void> = Promise.resolve();
  private idleResolve: (() => void) | null = null;
  /** Per-key timestamp of the last mid-flight index upsert (throttle). */
  private readonly progressUpsertAt = new Map<string, number>();

  constructor(private readonly deps: DownloadManagerDeps) {}

  async enqueue(jobs: DownloadJob[]): Promise<void> {
    for (const j of jobs) {
      if (this.deps.store.has(j.key)) continue;
      // Dedupe against our own queue AND records already in flight (the running
      // job is off the queue but its record is "downloading") — a second
      // enqueue of the same key must not re-download the file.
      if (this.queue.some((q) => q.job.key === j.key)) continue;
      const existing = this.deps.index.get(j.key);
      if (existing && isInFlight(existing)) continue;
      const format: DownloadFormat = this.deps.getQuality().mode === "aac" ? "aac" : "original";
      this.queue.push({ job: j, format });
      await this.record(j, format, "queued", 0);
    }
    this.pump();
  }

  drain(): Promise<void> {
    return this.idle;
  }

  private async record(
    job: DownloadJob,
    format: DownloadFormat,
    state: DownloadRecord["state"],
    bytes: number,
    error?: string,
    /** Terminal complete only: the ACTUAL committed size — authoritative for
     *  reconcile, so catalog drift can never demote a good file. */
    committedBytes?: number,
  ): Promise<void> {
    const existing = this.deps.index.get(job.key);
    // The catalog expectedBytes is pinned ONCE at enqueue (original only — an
    // AAC transcode has no predetermined size); later non-terminal writes
    // preserve whatever is pinned; the complete write overrides it with the
    // delivered size (both formats), which is what reconcile verifies against.
    const expectedBytes =
      committedBytes ??
      (state === "queued"
        ? format === "original"
          ? job.expectedBytes
          : undefined
        : existing?.expectedBytes);
    const rec: DownloadRecord = {
      key: job.key,
      serverId: job.serverId,
      plexPath: job.plexPath,
      trackId: job.trackId,
      format,
      state,
      bytes,
      addedAt: existing?.addedAt ?? Date.now(),
      error,
      meta: job.meta,
      origin: job.origin ?? "manual",
      expectedBytes,
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

  private async runJob(entry: QueueEntry): Promise<void> {
    const { job, format } = entry;
    await this.record(job, format, "downloading", 0);
    // Transfer at the PINNED format — quality.mode may have changed since enqueue.
    const quality: StorageQuality = {
      mode: format === "aac" ? "aac" : "original",
      bitrateKbps: this.deps.getQuality().bitrateKbps,
    };
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
          // Also persist mid-flight bytes on the record (throttled per key) so
          // byte-based UI moves during the transfer, not just at the end.
          const now = Date.now();
          if (now - (this.progressUpsertAt.get(job.key) ?? 0) >= PROGRESS_UPSERT_MS) {
            this.progressUpsertAt.set(job.key, now);
            const rec = this.deps.index.get(job.key);
            if (rec) void this.deps.index.upsert({ ...rec, state: "downloading", bytes: e.bytes });
          }
          return;
        }
        // A non-terminal error keeps the record "downloading" (PR2's native
        // engine will retry; JsTransferEngine errors are always terminal).
        if (e.kind === "error" && !e.terminal) return;
        off();
        this.progressUpsertAt.delete(job.key);
        if (e.kind === "complete") {
          // Delivered size is authoritative: persist it as expectedBytes (both
          // formats) so reconcile verifies against what actually landed.
          void this.record(job, format, "downloaded", e.bytes, undefined, e.bytes).then(resolve);
        } else void this.record(job, format, "failed", 0, e.message).then(resolve);
      });
      void this.deps.engine.submit([transfer]);
    });
  }

  async removeDownload(key: string): Promise<void> {
    this.deps.store.remove(key);
    await this.deps.index.remove(key);
  }
}
