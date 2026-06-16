import type { Track } from "@musex/core";
import { albumsForGenre, listValidator, sampleThumbs, tracksForGenre } from "@musex/core";
import { useEffect, useState } from "react";
import { useApp } from "../../state/app";
import { usePlayer } from "../../state/player";
import { useSelection } from "../../state/selection";
import { ActionBar } from "../discovery/ActionBar";
import { CardCollage } from "../CardCollage";
import { NewPlaylistDialog } from "../NewPlaylistDialog";
import type { TrackMenuTarget } from "../TrackContextMenu";
import { TrackContextMenu } from "../TrackContextMenu";
import { TrackRow } from "../TrackRow";
import { VirtualTrackList } from "../VirtualTrackList";

type FetchState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ok"; tracks: Track[]; thumbs: string[] };

/** Dynamic playlist for one genre: all tracks from albums tagged with it. */
export function GenreView({ genre }: { genre: string }) {
  const { library, dispatch } = useApp();
  const { state, playTracks, playTracksShuffled, playTrackNext } = usePlayer();
  const { selectedTrack, select } = useSelection();
  const [fetch, setFetch] = useState<FetchState>({ status: "loading" });
  const [menu, setMenu] = useState<TrackMenuTarget | null>(null);
  const [newSeed, setNewSeed] = useState<string[] | null>(null);

  useEffect(() => {
    if (!library) return;
    const id = library.id;
    const validator = listValidator(library.updatedAt);
    let cancelled = false;
    setFetch({ status: "loading" });
    Promise.all([
      window.musex.listAllAlbums(id, "title", validator),
      window.musex.listAllTracks(id, "title", validator),
    ])
      .then(([albums, tracks]) => {
        if (cancelled) return;
        const thumbs = sampleThumbs(
          albumsForGenre(genre, albums).map((a) => a.thumb),
          4,
          genre,
        );
        setFetch({ status: "ok", tracks: tracksForGenre(genre, albums, tracks), thumbs });
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setFetch({
            status: "error",
            message: err instanceof Error ? err.message : "Failed to load tracks",
          });
      });
    return () => {
      cancelled = true;
    };
  }, [library, genre]);

  const playingTrackId =
    state.queue != null ? (state.queue.tracks[state.queue.index]?.id ?? null) : null;

  return (
    <div className="tracks-view">
      <div className="breadcrumb">
        <button
          type="button"
          className="breadcrumb-link"
          onClick={() => dispatch({ type: "navigate", view: { name: "genres" } })}
        >
          Genres
        </button>
        {" › "}
        <span className="breadcrumb-current">{genre}</span>
      </div>

      <div className="tracks-view-header">
        <div className="browse-header">
          <div className="header-with-collage">
            {fetch.status === "ok" && (
              <CardCollage thumbs={fetch.thumbs} className="header-collage" />
            )}
            <h3 className="browse-title">{genre}</h3>
          </div>
          <div className="tracks-header-actions">
            {fetch.status === "ok" && fetch.tracks.length > 0 && (
              <ActionBar
                onPlay={() => playTracks(fetch.tracks, 0)}
                onShuffle={() => playTracksShuffled(fetch.tracks)}
              />
            )}
          </div>
        </div>
        {fetch.status === "ok" && (
          <div className="browse-sub">
            {fetch.tracks.length} track{fetch.tracks.length !== 1 ? "s" : ""}
          </div>
        )}
      </div>

      {fetch.status === "loading" && <div className="content-placeholder">Loading…</div>}

      {fetch.status === "error" && (
        <div className="content-placeholder error-text">Error: {fetch.message}</div>
      )}

      {fetch.status === "ok" && fetch.tracks.length === 0 && (
        <div className="content-placeholder">No tracks found for this genre.</div>
      )}

      {fetch.status === "ok" && fetch.tracks.length > 0 && (
        <VirtualTrackList
          count={fetch.tracks.length}
          renderRow={(index) => {
            const track = fetch.tracks[index];
            if (!track) return null;
            return (
              <TrackRow
                track={track}
                leading={null}
                showSubtitle
                isPlaying={track.id === playingTrackId}
                selected={track.id === selectedTrack?.id}
                onSelect={() => select(track)}
                onActivate={() => playTrackNext(track)}
                onMenu={(pos) =>
                  setMenu({
                    ...pos,
                    trackId: track.id,
                    serverId: track.serverId,
                    track,
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
