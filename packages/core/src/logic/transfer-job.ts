import type { DownloadJob } from "./download-plan.js";
import type { StorageQuality } from "./download-state.js";
import { buildHlsStartUrl, stopSessionUrl, TRANSCODE_PROFILE_EXTRA } from "./transcode-url.js";

/** Everything a transfer engine (JS or native) needs to run one download
 *  unattended — no callbacks into the caller, just URLs, headers and a
 *  destination. Serializable (crosses the native bridge as JSON). */
export interface TransferJob {
  key: string;
  /** convert = download the ORIGINAL file, then convert to AAC on-device. */
  mode: "original" | "hls" | "convert";
  /** original/convert: signed original-file URL; hls: signed start.m3u8 URL. */
  url: string;
  /** hls: token + profile-extra; original/convert: {}. */
  headers: Record<string, string>;
  /** Absolute filesystem path (no file:// scheme). Engines write to
   *  `destPath + ".part"` during transfer and move into place on commit. */
  destPath: string;
  /** original/convert only — a TRUNCATION guard on the downloaded original: a
   *  delivery smaller than this fails; a larger/differing delivery is accepted
   *  (the delivered size is authoritative — the Plex catalog can drift from
   *  the file it serves). Convert's terminal complete reports the m4a size. */
  expectedBytes?: number;
  /** hls only — best-effort Plex transcode-session stop. */
  stopUrl?: string;
  /** convert only — the on-device AAC target bitrate. */
  targetBitrateKbps?: number;
}

export interface TransferEndpoint {
  baseUrl: string;
  token: string;
}

/** Progress/terminal events an engine emits for its jobs. */
export type TransferEvent =
  | { kind: "progress"; key: string; bytes: number; segmentsDone?: number; segmentsTotal?: number }
  | { kind: "complete"; key: string; bytes: number }
  | { kind: "error"; key: string; message: string; terminal: boolean };

/** What an engine reports on reattach: keys still in flight plus results that
 *  landed while JS was away. */
export interface TransferSnapshot {
  active: string[];
  completed: { key: string; bytes: number }[];
  failed: { key: string; message: string }[];
}

/** Build the TransferJob for one DownloadJob — reproduces exactly the URL
 *  construction the DownloadManager used inline (original: token appended to
 *  the part path; hls: `buildHlsStartUrl` + transcode profile headers +
 *  `stopSessionUrl`). The caller supplies `session` (no Date.now in core). */
export function buildTransferJob(opts: {
  job: DownloadJob;
  quality: StorageQuality;
  endpoint: TransferEndpoint;
  clientId: string;
  destPath: string;
  session: string;
  /** aac only — emit mode "convert" (download the original, convert to AAC
   *  on-device) instead of "hls". The caller decides via `transferModeFor`;
   *  false/undefined behaves exactly as before. */
  convert?: boolean;
}): TransferJob {
  const { job, quality, endpoint, clientId, destPath, session, convert } = opts;
  if (quality.mode === "aac" && convert) {
    const sep = job.plexPath.includes("?") ? "&" : "?";
    return {
      key: job.key,
      mode: "convert",
      // Same construction as mode:"original" — the download IS the original.
      url: `${endpoint.baseUrl}${job.plexPath}${sep}X-Plex-Token=${encodeURIComponent(endpoint.token)}`,
      headers: {},
      destPath,
      expectedBytes: job.expectedBytes,
      targetBitrateKbps: quality.bitrateKbps,
    };
  }
  if (quality.mode === "aac") {
    return {
      key: job.key,
      mode: "hls",
      url: buildHlsStartUrl({
        baseUrl: endpoint.baseUrl,
        token: endpoint.token,
        clientId,
        session,
        trackId: job.trackId,
        bitrateKbps: quality.bitrateKbps,
      }),
      headers: {
        "X-Plex-Token": endpoint.token,
        "X-Plex-Client-Profile-Extra": TRANSCODE_PROFILE_EXTRA,
      },
      destPath,
      stopUrl: stopSessionUrl({
        baseUrl: endpoint.baseUrl,
        token: endpoint.token,
        clientId,
        session,
      }),
    };
  }
  const sep = job.plexPath.includes("?") ? "&" : "?";
  return {
    key: job.key,
    mode: "original",
    url: `${endpoint.baseUrl}${job.plexPath}${sep}X-Plex-Token=${encodeURIComponent(endpoint.token)}`,
    headers: {},
    destPath,
    expectedBytes: job.expectedBytes,
  };
}
