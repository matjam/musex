/** Metadata snapshot kept with a download so it's browsable offline. */
export interface DownloadMeta {
  title: string;
  artistName: string;
  albumTitle?: string;
  durationMs: number;
  thumb?: string;
  trackNumber?: number;
  albumId: string;
  artistId: string;
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
