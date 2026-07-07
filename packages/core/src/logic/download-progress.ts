import type { DownloadRecord } from "./download-state.js";

export type ContainerDownloadState = "none" | "downloading" | "partial" | "complete";

/** Aggregated download progress for one container (album/artist/playlist/whole
 *  collection): counts by state plus a bytes blend for a smooth bar. */
export interface ContainerDownloadProgress {
  done: number;
  total: number;
  inFlight: number;
  failed: number;
  /** Bytes landed so far (downloaded + in-flight progress). Dead records
   *  (failed/missing) retain full byte values but need re-downloading, so they
   *  are EXCLUDED — otherwise the fraction inflates. */
  bytes: number;
  /** Sum of expectedBytes when EVERY key has a record and every live
   *  (downloaded/in-flight) record defines one; otherwise null (in-flight AAC
   *  transcodes have no predetermined size). Failed/missing records are
   *  excluded, matching `bytes`. */
  expectedBytes: number | null;
  /** bytes/expectedBytes when known, else done/total; null when total === 0. */
  fraction: number | null;
  state: ContainerDownloadState;
}

/** Pure per-container progress aggregation: given the download index's records
 *  and a container's track keys, how far along is that container? A key with no
 *  record counts as not-started. `done` = downloaded; `inFlight` =
 *  queued|downloading; `failed` = failed|missing. */
export function downloadProgress(
  records: ReadonlyMap<string, DownloadRecord> | DownloadRecord[],
  keys: readonly string[],
): ContainerDownloadProgress {
  const byKey = Array.isArray(records)
    ? new Map(records.map((r) => [r.key, r]))
    : (records as ReadonlyMap<string, DownloadRecord>);

  const total = keys.length;
  let done = 0;
  let inFlight = 0;
  let failed = 0;
  let bytes = 0;
  let expectedSum = 0;
  let expectedKnown = true; // every key has a record AND every record has expectedBytes

  for (const key of keys) {
    const r = byKey.get(key);
    if (!r) {
      expectedKnown = false;
      continue;
    }
    switch (r.state) {
      case "downloaded":
        done += 1;
        break;
      case "queued":
      case "downloading":
        inFlight += 1;
        break;
      case "failed":
      case "missing":
        failed += 1;
        break;
    }
    // Dead records keep their last byte values but the track needs
    // re-downloading — counting them would inflate the byte fraction.
    if (r.state === "failed" || r.state === "missing") continue;
    bytes += r.bytes;
    if (r.expectedBytes === undefined) expectedKnown = false;
    else expectedSum += r.expectedBytes;
  }

  const expectedBytes = total > 0 && expectedKnown ? expectedSum : null;
  const fraction =
    total === 0
      ? null
      : expectedBytes !== null && expectedBytes > 0
        ? bytes / expectedBytes
        : done / total;
  const state: ContainerDownloadState =
    done === total && total > 0
      ? "complete"
      : inFlight > 0
        ? "downloading"
        : done > 0
          ? "partial"
          : "none";

  return { done, total, inFlight, failed, bytes, expectedBytes, fraction, state };
}
