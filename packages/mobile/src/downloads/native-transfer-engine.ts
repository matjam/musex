import type { TransferEvent, TransferJob, TransferSnapshot } from "@musex/core";
import type { TransferEngine } from "./transfer-engine";

/** Event payloads the native module emits (mirror of the Swift side and of
 *  `modules/background-downloads/index.ts`). */
export interface NativeTransferEvents {
  onProgress: (e: {
    key: string;
    bytes: number;
    segmentsDone?: number;
    segmentsTotal?: number;
  }) => void;
  /** `converted`/`bitrateKbps` are present only for convert jobs — the
   *  committed artifact is an on-device AAC m4a at that actual bitrate. */
  onComplete: (e: {
    key: string;
    bytes: number;
    converted?: boolean;
    bitrateKbps?: number;
  }) => void;
  onError: (e: { key: string; message: string; terminal: boolean }) => void;
}

/** Structural slice of the native module the engine needs — the real expo
 *  NativeModule satisfies it; tests pass a fake. */
export interface BackgroundDownloadsModuleLike {
  submit(jobsJson: string): Promise<void>;
  cancel(keys: string[]): Promise<void>;
  reattach(): Promise<string>;
  addListener<K extends keyof NativeTransferEvents>(
    eventName: K,
    listener: NativeTransferEvents[K],
  ): { remove(): void };
}

const EMPTY_SNAPSHOT: TransferSnapshot = { active: [], completed: [], failed: [] };

/** TransferEngine over the background-downloads native module: jobs cross the
 *  bridge as JSON, transfers run on a background URLSession (they continue
 *  while the app is suspended or killed), and results that landed while JS was
 *  away come back through `reattach()`. */
export class NativeTransferEngine implements TransferEngine {
  /** The native backlog is durable (survives suspend/kill) — the manager
   *  batch-submits everything and never awaits per job. */
  readonly ownsQueue = true;
  /** Whether the INSTALLED binary's module runs `"convert"` jobs (original
   *  download + on-device AVFoundation AAC conversion). Injected — the caller
   *  feature-detects the binary (see `nativeSupportsConvert()` in the module
   *  wrapper): a dev-client built before the convert generation would run a
   *  convert job down its HLS branch and reintroduce the media-404 storm. */
  readonly supportsConvert: boolean;
  private readonly listeners = new Set<(e: TransferEvent) => void>();

  constructor(
    private readonly mod: BackgroundDownloadsModuleLike,
    opts?: { supportsConvert?: boolean },
  ) {
    this.supportsConvert = opts?.supportsConvert ?? true;
    mod.addListener("onProgress", (e) =>
      this.emit({
        kind: "progress",
        key: e.key,
        bytes: e.bytes,
        segmentsDone: e.segmentsDone,
        segmentsTotal: e.segmentsTotal,
      }),
    );
    mod.addListener("onComplete", (e) =>
      this.emit({
        kind: "complete",
        key: e.key,
        bytes: e.bytes,
        converted: e.converted,
        bitrateKbps: e.bitrateKbps,
      }),
    );
    mod.addListener("onError", (e) =>
      this.emit({ kind: "error", key: e.key, message: e.message, terminal: e.terminal }),
    );
  }

  async submit(jobs: TransferJob[]): Promise<void> {
    if (jobs.length === 0) return;
    await this.mod.submit(JSON.stringify(jobs));
  }

  async cancel(keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    await this.mod.cancel(keys);
  }

  async reattach(): Promise<TransferSnapshot> {
    try {
      const parsed = JSON.parse(await this.mod.reattach()) as Partial<TransferSnapshot> | null;
      return {
        active: Array.isArray(parsed?.active) ? parsed.active : [],
        completed: Array.isArray(parsed?.completed) ? parsed.completed : [],
        failed: Array.isArray(parsed?.failed) ? parsed.failed : [],
      };
    } catch (err) {
      console.warn("[downloads] native reattach failed", err);
      return EMPTY_SNAPSHOT;
    }
  }

  onEvent(cb: (e: TransferEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit(e: TransferEvent): void {
    for (const cb of this.listeners) cb(e);
  }
}

/** Engine selection seam: null when the native module isn't in the binary
 *  (Expo Go, tests, pre-prebuild) — the caller falls back to JsTransferEngine. */
export function createNativeTransferEngine(
  mod: BackgroundDownloadsModuleLike | null,
  opts?: { supportsConvert?: boolean },
): TransferEngine | null {
  return mod ? new NativeTransferEngine(mod, opts) : null;
}
