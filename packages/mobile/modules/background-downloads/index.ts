import { NativeModule, requireNativeModule } from "expo";

export type BackgroundDownloadsEvents = {
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
};

export declare class BackgroundDownloadsModule extends NativeModule<BackgroundDownloadsEvents> {
  /** JSON-serialized `TransferJob[]` (core `transfer-job.ts`). Idempotent per key. */
  submit(jobsJson: string): Promise<void>;
  cancel(keys: string[]): Promise<void>;
  /** JSON-serialized `TransferSnapshot`; clears the native results buffer. */
  reattach(): Promise<string>;
  /** iOS Background App Refresh: "available" | "denied" | "restricted". */
  getBackgroundRefreshStatus(): Promise<string>;
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

/** Background App Refresh status, or null when the native module is absent
 *  (Expo Go, tests) — same safe-null pattern as the default export. */
export async function getBackgroundRefreshStatus(): Promise<string | null> {
  return native ? native.getBackgroundRefreshStatus() : null;
}

export default native;
