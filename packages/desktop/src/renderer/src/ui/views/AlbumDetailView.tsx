import type { Album, Track } from "@musex/core";
import { useEffect, useState } from "react";
import { listValidator } from "../../../../shared/list-validator";
import { useApp } from "../../state/app";
import { usePlayer } from "../../state/player";
import { AlbumArt } from "../AlbumArt";
import { NewPlaylistDialog } from "../NewPlaylistDialog";
import type { TrackMenuTarget } from "../TrackContextMenu";
import { TrackContextMenu } from "../TrackContextMenu";
import { TrackRow } from "../TrackRow";
import { VirtualTrackList } from "../VirtualTrackList";

type FetchState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ok"; tracks: Track[] };

interface Props {
  album: Album;
}

export function AlbumDetailView({ album }: Props) {
  const { library, dispatch } = useApp();
  const { state, playTracks } = usePlayer();
  const [fetch, setFetch] = useState<FetchState>({ status: "loading" });
  const [menu, setMenu] = useState<TrackMenuTarget | null>(null);
  const [newSeed, setNewSeed] = useState<string[] | null>(null);

  useEffect(() => {
    if (!library) return;
    const libraryId = library.id;
    setFetch({ status: "loading" });
    window.musex
      .listTracks(libraryId, album.id, listValidator(album.updatedAt))
      .then((tracks) => setFetch({ status: "ok", tracks }))
      .catch((err: unknown) =>
        setFetch({
          status: "error",
          message: err instanceof Error ? err.message : "Failed to load tracks",
        }),
      );
  }, [library, album.id, album.updatedAt]);

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
        <AlbumArt thumb={album.thumb} className="album-header-art" />
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
                onClick={() => playTracks(tracks, 0)}
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
        <VirtualTrackList
          count={tracks.length}
          renderRow={(index) => {
            const track = tracks[index];
            if (!track) return null;
            return (
              <TrackRow
                track={track}
                leading={track.trackNumber ?? index + 1}
                isPlaying={track.id === playingTrackId}
                onPlay={() => playTracks(tracks, index)}
                onMenu={(pos) =>
                  setMenu({
                    ...pos,
                    trackId: track.id,
                    serverId: track.serverId,
                  })
                }
              />
            );
          }}
        />
      )}

      {menu !== null && (
        <TrackContextMenu
          target={menu}
          onClose={() => setMenu(null)}
          onNewPlaylist={(id) => {
            setNewSeed([id]);
            setMenu(null);
          }}
        />
      )}

      {newSeed !== null && (
        <NewPlaylistDialog seedTrackIds={newSeed} onClose={() => setNewSeed(null)} />
      )}
    </div>
  );
}
