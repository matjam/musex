import type { DownloadMeta } from "./download-plan.js";

export type DownloadStatus = "queued" | "downloading" | "downloaded" | "failed" | "missing";
export type DownloadFormat = "original" | "mp3";

export interface StorageQuality {
  mode: "original" | "mp3";
  bitrateKbps: number;
}

export interface DownloadRecord {
  key: string;
  serverId: string;
  plexPath: string;
  trackId: string;
  format: DownloadFormat;
  state: DownloadStatus;
  bytes: number;
  addedAt: number;
  error?: string;
  meta: DownloadMeta;
}

/** On launch, mark any 'downloaded' record whose file vanished as 'missing'. Records
 *  still queued/downloading have no file yet, so they're left as-is. */
export function reconcileRecords(records: DownloadRecord[], presentKeys: ReadonlySet<string>): DownloadRecord[] {
  return records.map((r) =>
    r.state === "downloaded" && !presentKeys.has(r.key) ? { ...r, state: "missing" as const } : r,
  );
}
