import type { Track } from "@musex/core";
import { Play, Shuffle } from "lucide-react";
import { useEffect, useState } from "react";
import {
  computeSmartPlaylist,
  SMART_TITLES,
  type SmartKind,
} from "../../../../logic/smart-playlists";
import { listValidator } from "../../../../shared/list-validator";
import { useApp } from "../../state/app";
import { usePlayer } from "../../state/player";
import { useSelection } from "../../state/selection";
import { NewPlaylistDialog } from "../NewPlaylistDialog";
import type { TrackMenuTarget } from "../TrackContextMenu";
import { TrackContextMenu } from "../TrackContextMenu";
import { TrackRow } from "../TrackRow";
import { VirtualTrackList } from "../VirtualTrackList";

const EMPTY_MESSAGES: Record<SmartKind, string> = {
  "top-rated": "Nothing here yet — rate tracks 4 stars or more and they'll show up.",
  "heavy-rotation": "Nothing here yet — keep listening and your most-played tracks will show up.",
  rediscover: "Nothing to rediscover yet — favorites you haven't played in a while land here.",
};

type FetchState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ok"; tracks: Track[] };

export function SmartPlaylistView({ kind }: { kind: SmartKind }) {
  const { library } = useApp();
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
      window.musex.listAllTracks(id, "title", validator),
      window.musex.getTasteSnapshot(),
    ])
      .then(([tracks, snapshot]) => {
        if (cancelled) return;
        setFetch({
          status: "ok",
          tracks: computeSmartPlaylist(
            kind,
            tracks,
            snapshot.stats,
            snapshot.topArtists,
            Date.now(),
          ),
        });
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
  }, [library, kind]);

  const playingTrackId =
    state.queue != null ? (state.queue.tracks[state.queue.index]?.id ?? null) : null;

  return (
    <div className="tracks-view">
      <div className="tracks-view-header">
        <div className="browse-header">
          <h3 className="browse-title">{SMART_TITLES[kind]}</h3>
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
        <div className="content-placeholder">{EMPTY_MESSAGES[kind]}</div>
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
