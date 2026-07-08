import type { TransferEvent, TransferJob, TransferSnapshot } from "@musex/core";

/** The seam between the DownloadManager (queue policy, records, dedupe) and
 *  transfer *execution*. `JsTransferEngine` runs transfers in JS (Expo Go,
 *  tests); `NativeTransferEngine` runs them on a background URLSession. */
export interface TransferEngine {
  /** True when the engine holds its own durable backlog (native background
   *  URLSession): the manager submits the WHOLE batch up front and maps
   *  events as they come — no per-job await. False = the manager runs its
   *  sequential per-job loop (JS engine dies with the app). */
  readonly ownsQueue: boolean;
  /** Hand jobs to the engine (idempotent per key). */
  submit(jobs: TransferJob[]): Promise<void>;
  cancel(keys: string[]): Promise<void>;
  /** On launch: the engine's current state (active/completed/failed while JS
   *  was away). The JS engine always returns an empty snapshot. */
  reattach(): Promise<TransferSnapshot>;
  onEvent(cb: (e: TransferEvent) => void): () => void;
}
