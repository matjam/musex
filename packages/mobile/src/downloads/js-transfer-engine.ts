import {
  parseHlsMaster,
  parseHlsMedia,
  type TransferEvent,
  type TransferJob,
  type TransferSnapshot,
} from "@musex/core";
import type { FileStore, StoreWriter } from "./download-store";
import type { TransferEngine } from "./transfer-engine";

const SEGMENT_RETRY_DELAY_MS = 700;
const SEGMENT_RETRY_ATTEMPTS = 60;
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface JsTransferEngineDeps {
  store: FileStore;
  fetch: typeof fetch;
  /** Test seam only — segment 404-retry delay (default 700ms, the deliberate
   *  "give Plex time to transcode" pacing). */
  segmentRetryDelayMs?: number;
}

/** The in-process transfer engine: today's fetch/stitch execution code moved
 *  verbatim from the DownloadManager behind the TransferEngine seam. Runs an
 *  internal FIFO at concurrency 1; dies with JS (no background continuation —
 *  that's PR2's native engine), so `reattach()` is always empty and every
 *  error is terminal (no retry-later). */
export class JsTransferEngine implements TransferEngine {
  /** Dies with JS — the manager keeps its own queue and per-job await. */
  readonly ownsQueue = false;
  private queue: TransferJob[] = [];
  private running = false;
  private readonly listeners = new Set<(e: TransferEvent) => void>();

  constructor(private readonly deps: JsTransferEngineDeps) {}

  async submit(jobs: TransferJob[]): Promise<void> {
    for (const j of jobs) {
      if (this.queue.some((q) => q.key === j.key)) {
        // Never drop a job silently — a caller awaiting this job's terminal
        // event would hang forever. Duplicate submissions are a caller bug
        // (the manager dedupes); surface it as a terminal error.
        this.fail(j.key, "duplicate job already queued");
        continue;
      }
      this.queue.push(j);
    }
    this.pump();
  }

  async cancel(keys: string[]): Promise<void> {
    const drop = new Set(keys);
    this.queue = this.queue.filter((j) => !drop.has(j.key));
  }

  /** JS transfers die with the JS runtime — nothing to reattach to. */
  async reattach(): Promise<TransferSnapshot> {
    return { active: [], completed: [], failed: [] };
  }

  onEvent(cb: (e: TransferEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit(e: TransferEvent): void {
    for (const cb of this.listeners) cb(e);
  }

  private fail(key: string, message: string): void {
    this.emit({ kind: "error", key, message, terminal: true });
  }

  private pump(): void {
    if (this.running) return;
    this.running = true;
    void (async () => {
      while (this.queue.length) {
        const job = this.queue.shift();
        if (!job) break;
        await this.run(job);
      }
      this.running = false;
    })();
  }

  private async run(job: TransferJob): Promise<void> {
    if (job.mode === "hls") await this.runHls(job);
    else await this.runOriginal(job);
  }

  private async runOriginal(job: TransferJob): Promise<void> {
    try {
      const bytes = await this.deps.store.downloadUrl(job.key, job.url, (w) =>
        this.emit({ kind: "progress", key: job.key, bytes: w }),
      );
      // expectedBytes (the Plex catalog size) is a TRUNCATION guard only: an
      // under-delivery is a failed transfer, but the catalog can drift from the
      // file actually served, so a larger/differing delivery is accepted — the
      // DELIVERED size becomes the record's truth (the manager persists it on
      // complete). Rejecting any difference caused an infinite
      // fail→delete→re-queue loop via library sync.
      if (job.expectedBytes !== undefined && bytes < job.expectedBytes) {
        this.deps.store.remove(job.key);
        this.fail(job.key, `truncated: got ${bytes} want ${job.expectedBytes}`);
        return;
      }
      if (job.expectedBytes === undefined && bytes <= 0) {
        this.deps.store.remove(job.key);
        this.fail(job.key, "empty download");
        return;
      }
      if (job.expectedBytes !== undefined && bytes !== job.expectedBytes) {
        console.warn(
          `[downloads] size differs from Plex catalog (got ${bytes}, want ${job.expectedBytes}), accepting delivered file`,
          job.key,
        );
      }
      this.emit({ kind: "complete", key: job.key, bytes });
    } catch (e) {
      this.deps.store.remove(job.key);
      this.fail(job.key, e instanceof Error ? e.message : String(e));
    }
  }

  private async runHls(job: TransferJob): Promise<void> {
    const { headers } = job;
    let w: StoreWriter | null = null;
    try {
      const startRes = await this.deps.fetch(job.url, { headers });
      if (!startRes.ok) {
        this.fail(job.key, `hls start ${startRes.status}`);
        return;
      }
      const startText = await startRes.text();
      const variant = parseHlsMaster(startText);
      let mediaUrl = job.url;
      let mediaText = startText;
      if (variant) {
        mediaUrl = new URL(variant, job.url).toString();
        const mediaRes = await this.deps.fetch(mediaUrl, { headers });
        if (!mediaRes.ok) {
          this.fail(job.key, `hls media ${mediaRes.status}`);
          return;
        }
        mediaText = await mediaRes.text();
      }
      const { segments, ended } = parseHlsMedia(mediaText);
      if (segments.length === 0) {
        this.fail(job.key, "no segments");
        return;
      }
      w = this.deps.store.beginWrite(job.key);
      let total = 0;
      let done = 0;
      for (const seg of segments) {
        const bytes = await this.fetchSegment(new URL(seg.uri, mediaUrl).toString(), headers);
        if (bytes === null) {
          await w.abort();
          w = null;
          this.fail(job.key, `segment unavailable: ${seg.uri}`);
          return;
        }
        w.write(bytes);
        total += bytes.byteLength;
        done += 1;
        this.emit({
          kind: "progress",
          key: job.key,
          bytes: total,
          segmentsDone: done,
          segmentsTotal: segments.length,
        });
      }
      if (!ended) {
        await w.abort();
        w = null;
        this.fail(job.key, "incomplete playlist (no ENDLIST)");
        return;
      }
      await w.commit();
      w = null;
      this.emit({ kind: "complete", key: job.key, bytes: total });
    } catch (e) {
      if (w) await w.abort();
      this.fail(job.key, e instanceof Error ? e.message : String(e));
    } finally {
      if (job.stopUrl)
        await this.deps
          .fetch(job.stopUrl)
          .catch((err) => console.warn("[downloads] hls stop-session failed", err));
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
      await delay(this.deps.segmentRetryDelayMs ?? SEGMENT_RETRY_DELAY_MS);
    }
    return null;
  }
}
