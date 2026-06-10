/**
 * Pure album-state derivation — no I/O, fully unit-tested.
 *
 * Field semantics verified against the Lidarr OpenAPI spec (AlbumResource +
 * AlbumStatisticsResource): `statistics.trackFileCount` / `totalTrackCount`
 * count files on disk vs tracks in the release; `monitored` means Lidarr will
 * grab the album. "unavailable" is decided at the lookup level (metadata
 * lookup can't produce the album / artist unknown), not here.
 */

export type AlbumStateInput = {
  monitored: boolean;
  statistics?: { trackFileCount: number; totalTrackCount: number } | null;
  grabbed?: boolean;
};

export type DerivedAlbumState = {
  state: "downloaded" | "downloading" | "requested" | "available";
  detail?: string;
};

export function deriveAlbumState(album: AlbumStateInput, inQueue: boolean): DerivedAlbumState {
  const stats = album.statistics;
  const have = stats?.trackFileCount ?? 0;
  const want = stats?.totalTrackCount ?? 0;
  if (have > 0 && have >= want) {
    return { state: "downloaded", detail: `${have}/${want} tracks` };
  }
  if (inQueue) {
    // Caller overlays a progress detail from the queue record.
    return { state: "downloading" };
  }
  if (album.monitored) {
    return have > 0
      ? { state: "requested", detail: `${have}/${want} tracks` }
      : { state: "requested" };
  }
  return { state: "available" };
}
