import { NativeModule, requireNativeModule } from "expo";

export type BackgroundDownloadsEvents = {
  onProgress: (e: {
    key: string;
    bytes: number;
    segmentsDone?: number;
    segmentsTotal?: number;
  }) => void;
  onComplete: (e: { key: string; bytes: number }) => void;
  onError: (e: { key: string; message: string; terminal: boolean }) => void;
};

export declare class BackgroundDownloadsModule extends NativeModule<BackgroundDownloadsEvents> {
  /** JSON-serialized `TransferJob[]` (core `transfer-job.ts`). Idempotent per key. */
  submit(jobsJson: string): Promise<void>;
  cancel(keys: string[]): Promise<void>;
  /** JSON-serialized `TransferSnapshot`; clears the native results buffer. */
  reattach(): Promise<string>;
}

// requireNativeModule throws when the native module isn't built into the binary
// (Expo Go, unit tests, pre-prebuild). Swallow that so importing this module is
// always safe; consumers null-check the default export.
let native: BackgroundDownloadsModule | null = null;
try {
  native = requireNativeModule<BackgroundDownloadsModule>("BackgroundDownloads");
} catch {
  native = null;
}

export default native;
