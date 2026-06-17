/** Metadata snapshot kept with a download so it's browsable AND playable
 *  offline. The media fields (container/audioCodec/partId/bitrate) carry the
 *  rest of a Track's MediaInfo so a record can be reconstructed into a fully
 *  playable Track without a Plex round-trip (the record's plexPath is the
 *  MediaInfo.partKey). */
export interface DownloadMeta {
  title: string;
  artistName: string;
  albumTitle?: string;
  durationMs: number;
  thumb?: string;
  trackNumber?: number;
  albumId: string;
  artistId: string;
  // Media info needed to rebuild Track.media for offline playback. The partKey
  // is the record's plexPath, so it isn't duplicated here.
  container: string;
  audioCodec: string;
  partId: string;
  bitrate?: number;
}

export interface DownloadJob {
  /** Opaque store key (desktop computes cacheKey(serverId, plexPath)). */
  key: string;
  serverId: string;
  plexPath: string;
  trackId: string;
  meta: DownloadMeta;
}

/** Drop jobs already present (by key) and de-duplicate within the batch, preserving order. */
export function dedupeJobs(jobs: DownloadJob[], alreadyHave: ReadonlySet<string>): DownloadJob[] {
  const seen = new Set(alreadyHave);
  const out: DownloadJob[] = [];
  for (const j of jobs) {
    if (seen.has(j.key)) continue;
    seen.add(j.key);
    out.push(j);
  }
  return out;
}
