import {
  buildTransferJob,
  type ConnectionType,
  type DownloadFormat,
  type DownloadJob,
  type DownloadMeta,
  type DownloadRecord,
  isInFlight,
  type StorageQuality,
  type TransferEvent,
  type TransferJob,
  transferModeFor,
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
  /** Executes transfers (JS in Expo Go/tests; native background engine in real builds). */
  engine: TransferEngine;
  endpoint: (serverId: string) => Promise<{ baseUrl: string; token: string }>;
  clientId: string;
  getQuality: () => StorageQuality;
  /** Current network class (connectivity monitor) — feeds `transferModeFor`:
   *  AAC routes to on-device conversion off-cellular, server HLS on cellular. */
  getConnectionType: () => ConnectionType;
  onProgress: (e: DownloadProgress) => void;
}

/** A queued download plus the quality mode pinned at enqueue time — a Settings
 *  quality toggle mid-lifecycle must not flip an already-recorded job's format
 *  against its transfer (or an already-committed file). Convert-mode entries
 *  also carry the transfer mode + target bitrate so the terminal complete can
 *  patch the record's media meta to the actual artifact. */
interface QueueEntry {
  job: DownloadJob;
  format: DownloadFormat;
  mode?: TransferJob["mode"];
  targetBitrateKbps?: number;
}

/** The record meta for a finished convert job: the artifact on disk is an
 *  AAC-in-m4a at the target bitrate, not the catalog original. */
function convertedMeta(meta: DownloadMeta, targetBitrateKbps?: number): DownloadMeta {
  return { ...meta, container: "m4a", audioCodec: "aac", bitrate: targetBitrateKbps };
}

/** Plex transcode-session ids must be PLAIN tokens: Plex embeds the session in
 *  server-side paths and in the variant URI of the master playlist it returns.
 *  The old `${key}-${Date.now()}` id contained the download key's `␟` and `/`
 *  characters, and the follow-up media-playlist fetch 404'd on-device for every
 *  track ("hls media http 404"). Alphanumeric-only, unique per call — the shape
 *  Plex clients use (desktop uses UUIDs against the same endpoint). */
let sessionCounter = 0;
function plexSessionId(): string {
  sessionCounter += 1;
  return `musex${Date.now().toString(36)}${sessionCounter.toString(36)}`;
}

// Minimum interval between mid-flight record upserts per key. The index's own
// 600ms debounced persist handles disk; this just bounds in-memory churn.
const PROGRESS_UPSERT_MS = 500;

/** The download orchestrator: queue policy, dedupe, record bookkeeping. The
 *  actual transfer runs behind the TransferEngine seam, its events mapped back
 *  onto index records. Two execution shapes, keyed on `engine.ownsQueue`:
 *
 *  - `ownsQueue` (native background engine): enqueue records every job then
 *    submits the WHOLE batch to the native backlog at once — so a killed app
 *    still drains everything, and no JS await sits between jobs. A single
 *    persistent `onEvent` subscription maps events onto records for ANY key
 *    (manager-submitted, reattached-active from a previous run, or orphan).
 *    Events are buffered until `markReady()` (bootstrap calls it after the
 *    reattach fold, so folding always wins over live events).
 *  - `!ownsQueue` (JS engine): the sequential per-job-await loop — one job at
 *    a time (concurrency 1, politeness alongside live streaming); the JS
 *    engine dies with the app so there is nothing to hand a backlog to. */
export class DownloadManager {
  /** JS-engine mode only — the manager-owned FIFO. */
  private queue: QueueEntry[] = [];
  private running = false;
  private idle: Promise<void> = Promise.resolve();
  private idleResolve: (() => void) | null = null;
  /** Native mode only — jobs this manager instance submitted, by key. */
  private readonly submitted = new Map<string, QueueEntry>();
  /** Native mode: events held back until markReady() releases them. */
  private pending: TransferEvent[] = [];
  private ready = false;
  private offEngine: (() => void) | null = null;
  /** Per-key timestamp of the last mid-flight index upsert (throttle). */
  private readonly progressUpsertAt = new Map<string, number>();

  constructor(private readonly deps: DownloadManagerDeps) {
    this.ensureSubscribed();
  }

  private ensureSubscribed(): void {
    if (!this.deps.engine.ownsQueue || this.offEngine) return;
    this.offEngine = this.deps.engine.onEvent((e) => {
      if (!this.ready) {
        this.pending.push(e);
        return;
      }
      void this.handleEngineEvent(e);
    });
  }

  /** Release buffered engine events. Bootstrap calls this AFTER folding the
   *  reattach snapshot into the index — a terminal event that raced the fold
   *  must never be applied to not-yet-loaded records (the orphan-cleanup rule
   *  would delete a good file). */
  markReady(): void {
    this.ensureSubscribed(); // re-attach after a dispose() (effect re-run)
    void (async () => {
      while (this.pending.length > 0) {
        const e = this.pending.shift();
        if (e) await this.handleEngineEvent(e);
      }
      this.ready = true;
    })();
  }

  /** Detach the persistent engine subscription (bootstrap effect cleanup). */
  dispose(): void {
    this.offEngine?.();
    this.offEngine = null;
  }

  async enqueue(jobs: DownloadJob[]): Promise<void> {
    if (this.deps.engine.ownsQueue) {
      await this.enqueueNative(jobs);
      return;
    }
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

  /** Native path: build EVERY TransferJob now (format pinned per entry) and
   *  hand the whole batch to the native backlog — no per-job await, no
   *  manager-side queue. Completion is the engine's job; events come back
   *  through the persistent subscription. */
  private async enqueueNative(jobs: DownloadJob[]): Promise<void> {
    const transfers: TransferJob[] = [];
    for (const j of jobs) {
      if (this.deps.store.has(j.key)) continue;
      if (this.submitted.has(j.key)) continue;
      // A reattached-active record (submitted by a previous run, still on the
      // native backlog) is in flight too — never double-submit it.
      const existing = this.deps.index.get(j.key);
      if (existing && isInFlight(existing)) continue;
      const format: DownloadFormat = this.deps.getQuality().mode === "aac" ? "aac" : "original";
      const quality: StorageQuality = {
        mode: format === "aac" ? "aac" : "original",
        bitrateKbps: this.deps.getQuality().bitrateKbps,
      };
      // AAC travels as on-device conversion (native original download + local
      // AAC encode) when the engine supports it and we're off cellular; server
      // HLS otherwise. The pinned format stays "aac" — the artifact is AAC.
      const mode = transferModeFor({
        qualityMode: quality.mode,
        nativeConvertAvailable: !!this.deps.engine.supportsConvert,
        connectionType: this.deps.getConnectionType(),
      });
      let transfer: TransferJob;
      try {
        const ep = await this.deps.endpoint(j.serverId);
        transfer = buildTransferJob({
          job: j,
          quality,
          endpoint: ep,
          clientId: this.deps.clientId,
          destPath: this.deps.store.path(j.key),
          // Session id is caller-supplied (core stays Date.now-free).
          session: plexSessionId(),
          convert: mode === "convert",
        });
      } catch (err) {
        // Endpoint unresolved (server not connected) — surface it, never
        // leave a queued record with no job behind it.
        await this.record(j, format, "failed", 0, err instanceof Error ? err.message : String(err));
        continue;
      }
      this.submitted.set(j.key, {
        job: j,
        format,
        mode: transfer.mode,
        targetBitrateKbps: transfer.targetBitrateKbps,
      });
      await this.record(j, format, "queued", 0);
      transfers.push(transfer);
    }
    if (transfers.length > 0) await this.deps.engine.submit(transfers);
  }

  drain(): Promise<void> {
    // Native mode: the native backlog owns completion (transfers keep running
    // while the app is suspended or killed) — there is nothing meaningful for
    // JS to await. JS tests exercise the drain semantics via the JS engine.
    if (this.deps.engine.ownsQueue) return Promise.resolve();
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

  /** Persist mid-flight bytes on the record (throttled per key) so byte-based
   *  UI moves during the transfer, not just at the end. */
  private upsertProgress(key: string, bytes: number): void {
    const now = Date.now();
    if (now - (this.progressUpsertAt.get(key) ?? 0) < PROGRESS_UPSERT_MS) return;
    this.progressUpsertAt.set(key, now);
    const rec = this.deps.index.get(key);
    if (rec) void this.deps.index.upsert({ ...rec, state: "downloading", bytes });
  }

  /** Native mode: the persistent event→record mapping, for ANY key. */
  private async handleEngineEvent(e: TransferEvent): Promise<void> {
    if (e.kind === "error" && e.terminal && e.message === "cancelled") {
      // Every native cancel is JS-initiated (removeDownload / quality-change
      // re-enqueue), and the canceller does its own record/file bookkeeping —
      // so a terminal "cancelled" is cleanup-only: delete an orphan file when
      // NO record tracks the key, otherwise ignore it (an existing record
      // belongs to a NEWER life of the key, e.g. a re-enqueue racing the
      // stale cancel event, and must not be marked failed).
      if (!this.deps.index.get(e.key)) this.deps.store.remove(e.key);
      return;
    }
    const entry = this.submitted.get(e.key);
    if (entry) {
      const { job, format } = entry;
      if (e.kind === "progress") {
        this.deps.onProgress({ key: e.key, state: "downloading", bytes: e.bytes });
        this.upsertProgress(e.key, e.bytes);
        return;
      }
      // A non-terminal error keeps the record "downloading" (the native
      // engine retries on its own backoff).
      if (e.kind === "error" && !e.terminal) return;
      this.submitted.delete(e.key);
      this.progressUpsertAt.delete(e.key);
      if (e.kind === "complete") {
        // Delivered size is authoritative: persist it as expectedBytes (both
        // formats) so reconcile verifies against what actually landed. A
        // convert job's artifact is the on-device AAC m4a — patch the media
        // meta so recordToTrack reconstructs the real file.
        const finished =
          entry.mode === "convert"
            ? { ...job, meta: convertedMeta(job.meta, entry.targetBitrateKbps) }
            : job;
        await this.record(finished, format, "downloaded", e.bytes, undefined, e.bytes);
      } else {
        await this.record(job, format, "failed", 0, e.message);
      }
      return;
    }
    // Not ours: a job submitted by a previous run, reattached-active on the
    // native backlog — patch its existing index record directly.
    const rec = this.deps.index.get(e.key);
    if (rec) {
      if (e.kind === "progress") {
        void this.deps.index.upsert({ ...rec, state: "downloading", bytes: e.bytes });
        this.deps.onProgress({ key: e.key, state: "downloading", bytes: e.bytes });
        return;
      }
      if (e.kind === "error" && !e.terminal) return;
      if (e.kind === "complete") {
        // Delivered size is authoritative (same rule as the submitted path).
        // A reattached aac record completing here came off the NATIVE backlog
        // (JS HLS jobs die with the app, so they're always in `submitted`) —
        // on a convert-capable engine that makes it a convert job from a
        // previous run: apply the same artifact meta patch. Bitrate is the
        // current quality setting (the previous run's exact target isn't
        // retrievable from JS — best available).
        const meta =
          this.deps.engine.supportsConvert && rec.format === "aac"
            ? convertedMeta(rec.meta, this.deps.getQuality().bitrateKbps)
            : rec.meta;
        await this.deps.index.upsert({
          ...rec,
          meta,
          state: "downloaded",
          bytes: e.bytes,
          expectedBytes: e.bytes,
          error: undefined,
        });
        this.deps.onProgress({ key: e.key, state: "downloaded", bytes: e.bytes });
      } else {
        await this.deps.index.upsert({ ...rec, state: "failed", bytes: 0, error: e.message });
        this.deps.onProgress({ key: e.key, state: "failed", bytes: 0, error: e.message });
      }
      return;
    }
    // No record at all: an orphan — e.g. a download removed while its
    // transfer ran to completion in the background. Clean the file up; never
    // create a record from an event.
    if (e.kind === "complete" || (e.kind === "error" && e.terminal)) {
      this.deps.store.remove(e.key);
    }
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
    // Same routing decision as the native path — moot for the plain JS engine
    // (supportsConvert is never set there), kept uniform for correctness.
    const mode = transferModeFor({
      qualityMode: quality.mode,
      nativeConvertAvailable: !!this.deps.engine.supportsConvert,
      connectionType: this.deps.getConnectionType(),
    });
    const ep = await this.deps.endpoint(job.serverId);
    const transfer = buildTransferJob({
      job,
      quality,
      endpoint: ep,
      clientId: this.deps.clientId,
      destPath: this.deps.store.path(job.key),
      // Session id is caller-supplied (core stays Date.now-free).
      session: plexSessionId(),
      convert: mode === "convert",
    });
    // Map this job's engine events back onto records; resolve on the terminal one.
    await new Promise<void>((resolve) => {
      const off = this.deps.engine.onEvent((e) => {
        if (e.key !== job.key) return;
        if (e.kind === "progress") {
          this.deps.onProgress({ key: job.key, state: "downloading", bytes: e.bytes });
          this.upsertProgress(job.key, e.bytes);
          return;
        }
        // A non-terminal error keeps the record "downloading" (JsTransferEngine
        // errors are always terminal; this guard mirrors the native contract).
        if (e.kind === "error" && !e.terminal) return;
        off();
        this.progressUpsertAt.delete(job.key);
        if (e.kind === "complete") {
          // Delivered size is authoritative: persist it as expectedBytes (both
          // formats) so reconcile verifies against what actually landed.
          const finished =
            transfer.mode === "convert"
              ? { ...job, meta: convertedMeta(job.meta, transfer.targetBitrateKbps) }
              : job;
          void this.record(finished, format, "downloaded", e.bytes, undefined, e.bytes).then(
            resolve,
          );
        } else void this.record(job, format, "failed", 0, e.message).then(resolve);
      });
      void this.deps.engine.submit([transfer]);
    });
  }

  /** Drop still-queued (not yet running) jobs — a storage quality change
   *  re-bakes their transfer URLs, so the old entries must not run; the caller
   *  drops their records and re-enqueues. A job mid-download is untouched (it
   *  finishes in its pinned mode). Native mode: the submitted entries go FIRST
   *  so the engine's terminal "cancelled" events map to nothing (see
   *  handleEngineEvent), then the keys are cancelled on the native backlog. */
  async cancelQueued(keys: string[]): Promise<void> {
    const drop = new Set(keys);
    for (const k of keys) this.submitted.delete(k);
    this.queue = this.queue.filter((q) => !drop.has(q.job.key));
    await this.deps.engine.cancel(keys);
  }

  async removeDownload(key: string): Promise<void> {
    // Cancel the transfer FIRST — deleting file+record while the engine still
    // ran the job meant a mid-flight completion re-created the record (or the
    // native engine rewrote the just-deleted file). The submitted entry goes
    // before the cancel so the terminal "cancelled" event maps to nothing;
    // a late complete then hits the no-record orphan cleanup instead of
    // resurrecting anything.
    this.submitted.delete(key);
    this.queue = this.queue.filter((q) => q.job.key !== key);
    await this.deps.engine.cancel([key]);
    this.deps.store.remove(key);
    await this.deps.index.remove(key);
  }
}
