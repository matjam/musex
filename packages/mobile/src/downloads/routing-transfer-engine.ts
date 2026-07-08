import type { TransferEvent, TransferJob, TransferSnapshot } from "@musex/core";
import type { TransferEngine } from "./transfer-engine";

/** Routes transfers by job mode: HLS/AAC jobs run on the JS engine
 *  (foreground), Original jobs on the native background engine.
 *
 *  Why (field-debugged 2026-07-07/08, invoking the spec's pre-agreed AAC
 *  fallback contract): PMS reaps an AAC/HLS transcode session within ~1-2s of
 *  the transcoder finishing unconsumed, and a same-client second `start`
 *  400s — so the native engine's chained background tasks, which land
 *  seconds apart by design (one URLSession task per delegate step), always
 *  404'd at the media playlist ("hls media http 404"). The JS engine's
 *  back-to-back fetches consume the playlists within the window, so HLS works
 *  there and nowhere else today. A future native-HLS option: do the
 *  playlist + segment fetches as immediate data-tasks inside delegate wake
 *  windows (a later spike).
 *
 *  `ownsQueue = true`: the manager batch-submits everything up front and maps
 *  events through its single persistent subscription. That is safe for the
 *  JS half because JsTransferEngine keeps its own internal FIFO (submit
 *  pushes onto a queue drained at concurrency 1 by its pump loop — verified),
 *  so fire-and-forget batch submission never drops or interleaves jobs. JS
 *  HLS jobs die with the app; on relaunch they are absent from the merged
 *  reattach snapshot's `active` set, so `resolveStaleInFlight` drops their
 *  records and the next sync pass re-queues them — the intended recovery. */
export class RoutingTransferEngine implements TransferEngine {
  readonly ownsQueue = true;

  constructor(private readonly engines: { hls: TransferEngine; original: TransferEngine }) {}

  async submit(jobs: TransferJob[]): Promise<void> {
    const hls = jobs.filter((j) => j.mode === "hls");
    const original = jobs.filter((j) => j.mode !== "hls");
    if (hls.length > 0) await this.engines.hls.submit(hls);
    if (original.length > 0) await this.engines.original.submit(original);
  }

  /** The router doesn't track which engine got a key — both engines ignore
   *  unknown keys (JS: queue filter; native Swift: removeAll/activeTasks
   *  lookups no-op and emit nothing for keys they never had — verified), so
   *  cancelling everywhere is safe. */
  async cancel(keys: string[]): Promise<void> {
    await Promise.all([this.engines.hls.cancel(keys), this.engines.original.cancel(keys)]);
  }

  /** Merge both snapshots (the JS engine's is always empty). */
  async reattach(): Promise<TransferSnapshot> {
    const [h, o] = await Promise.all([
      this.engines.hls.reattach(),
      this.engines.original.reattach(),
    ]);
    return {
      active: [...h.active, ...o.active],
      completed: [...h.completed, ...o.completed],
      failed: [...h.failed, ...o.failed],
    };
  }

  onEvent(cb: (e: TransferEvent) => void): () => void {
    const offs = [this.engines.hls.onEvent(cb), this.engines.original.onEvent(cb)];
    return () => {
      for (const off of offs) off();
    };
  }
}
