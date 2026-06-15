import type { LibrarySort, Track } from "@musex/core";
import { listValidator } from "@musex/core";
import { Play, Shuffle } from "lucide-react";
import { useEffect, useState } from "react";
import { useApp } from "../../state/app";
import { usePlayer } from "../../state/player";
import { useSelection } from "../../state/selection";
import { NewPlaylistDialog } from "../NewPlaylistDialog";
import { SortSelector } from "../SortSelector";
import type { TrackMenuTarget } from "../TrackContextMenu";
import { TrackContextMenu } from "../TrackContextMenu";
import { TrackRow } from "../TrackRow";
import { VirtualTrackList } from "../VirtualTrackList";

type FetchState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ok"; tracks: Track[] };

export function TracksView() {
  const { library } = useApp();
  const { state, playTracks, playTracksShuffled, playTrackNext } = usePlayer();
  const { selectedTrack, select } = useSelection();
  const [sort, setSort] = useState<LibrarySort>("title");
  const [fetch, setFetch] = useState<FetchState>({ status: "loading" });
  const [menu, setMenu] = useState<TrackMenuTarget | null>(null);
  const [newSeed, setNewSeed] = useState<string[] | null>(null);

  useEffect(() => {
    if (!library) return;
    const id = library.id;
    const validator = listValidator(library.updatedAt);
    let cancelled = false;
    setFetch({ status: "loading" });
    window.musex
      .listAllTracks(id, sort, validator)
      .then((tracks) => {
        if (!cancelled) setFetch({ status: "ok", tracks });
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
  }, [library, sort]);

  const playingTrackId =
    state.queue != null ? (state.queue.tracks[state.queue.index]?.id ?? null) : null;

  return (
    <div className="tracks-view">
      <div className="tracks-view-header">
        <div className="browse-header">
          <h3 className="browse-title">Tracks</h3>
          <div className="tracks-header-actions">
            {fetch.status === "ok" && fetch.tracks.length > 0 && (
              <>
                <button
                  type="button"
                  className="play-btn"
                  title="Play all"
                  onClick={() => playTracks(fetch.tracks, 0)}
                >
                  <Play size={18} />
                </button>
                <button
                  type="button"
                  className="shuffle-btn"
                  title="Shuffle all"
                  onClick={() => playTracksShuffled(fetch.tracks)}
                >
                  <Shuffle size={16} />
                </button>
              </>
            )}
            <SortSelector value={sort} onChange={setSort} />
          </div>
        </div>
        {fetch.status === "ok" && (
          <div className="browse-sub">
            {fetch.tracks.length} track{fetch.tracks.length !== 1 ? "s" : ""}
          </div>
        )}
      </div>

      {fetch.status === "loading" && <div className="content-placeholder">Loading tracks…</div>}

      {fetch.status === "error" && (
        <div className="content-placeholder error-text">Error: {fetch.message}</div>
      )}

      {fetch.status === "ok" && fetch.tracks.length === 0 && (
        <div className="content-placeholder">No tracks found in this library.</div>
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
