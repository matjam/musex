import type { Album, Track } from "@musex/core";
import { useEffect, useState } from "react";
import { useApp } from "../../state/app";
import { usePlayer } from "../../state/player";
import { formatDuration } from "../../util/format";

type FetchState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ok"; tracks: Track[] };

interface Props {
  album: Album;
}

export function AlbumDetailView({ album }: Props) {
  const { library, dispatch } = useApp();
  const { state, playAlbum } = usePlayer();
  const [fetch, setFetch] = useState<FetchState>({ status: "loading" });

  useEffect(() => {
    if (!library) return;
    const libraryId = library.id;
    setFetch({ status: "loading" });
    window.musex
      .listTracks(libraryId, album.id)
      .then((tracks) => setFetch({ status: "ok", tracks }))
      .catch((err: unknown) =>
        setFetch({
          status: "error",
          message: err instanceof Error ? err.message : "Failed to load tracks",
        }),
      );
  }, [library, album.id]);

  // Determine the currently-playing track id (if any)
  const playingTrackId =
    state.queue != null ? (state.queue.tracks[state.queue.index]?.id ?? null) : null;

  // Compute totals from track list for the header
  const tracks = fetch.status === "ok" ? fetch.tracks : [];
  const totalMs = tracks.reduce((sum, t) => sum + t.durationMs, 0);
  const totalMin = Math.round(totalMs / 60000);

  // Navigate back to artist (we need the artist — album has artistId but not the full Artist object)
  // We'll navigate to artists list since we don't have the artist object here
  function goBack() {
    dispatch({ type: "navigate", view: { name: "artists" } });
  }

  return (
    <div className="album-detail">
      <div className="breadcrumb">
        <button type="button" className="breadcrumb-link" onClick={goBack}>
          Artists
        </button>
        {" › "}
        <span className="breadcrumb-current">{album.title}</span>
      </div>

      <div className="album-header">
        <div className="album-header-art" />
        <div className="album-header-meta">
          <div className="album-meta-label">Album</div>
          <h1 className="album-meta-title">{album.title}</h1>
          <div className="album-meta-by">
            {fetch.status === "ok" && fetch.tracks.length > 0 && (
              <span className="album-meta-muted">
                {album.year != null ? `${album.year} · ` : ""}
                {tracks.length} song{tracks.length !== 1 ? "s" : ""} · {totalMin} min
              </span>
            )}
          </div>
          {fetch.status === "ok" && tracks.length > 0 && (
            <div className="album-actions">
              <button
                type="button"
                className="play-btn"
                title="Play album"
                onClick={() => playAlbum(tracks, 0)}
              >
                ▶
              </button>
            </div>
          )}
        </div>
      </div>

      {fetch.status === "loading" && <div className="content-placeholder">Loading tracks…</div>}

      {fetch.status === "error" && (
        <div className="content-placeholder error-text">Error: {fetch.message}</div>
      )}

      {fetch.status === "ok" && tracks.length === 0 && (
        <div className="content-placeholder">No tracks found for this album.</div>
      )}

      {fetch.status === "ok" && tracks.length > 0 && (
        <div className="track-list">
          {tracks.map((track, index) => {
            const isPlaying = track.id === playingTrackId;
            return (
              <button
                type="button"
                key={track.id}
                className={`track-row${isPlaying ? " playing" : ""}`}
                onClick={() => playAlbum(tracks, index)}
              >
                <span className="track-num">
                  {isPlaying ? "▶" : (track.trackNumber ?? index + 1)}
                </span>
                <span className="track-title">{track.title}</span>
                <span className="track-duration">{formatDuration(track.durationMs)}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
