import type { TransferEvent, TransferJob, TransferSnapshot } from "@musex/core";

/** The seam between the DownloadManager (queue policy, records, dedupe) and
 *  transfer *execution*. `JsTransferEngine` runs transfers in JS (today's
 *  behavior); PR2's native engine runs them on a background URLSession. */
export interface TransferEngine {
  /** Hand jobs to the engine (idempotent per key). */
  submit(jobs: TransferJob[]): Promise<void>;
  cancel(keys: string[]): Promise<void>;
  /** On launch: the engine's current state (active/completed/failed while JS
   *  was away). The JS engine always returns an empty snapshot. */
  reattach(): Promise<TransferSnapshot>;
  onEvent(cb: (e: TransferEvent) => void): () => void;
}
