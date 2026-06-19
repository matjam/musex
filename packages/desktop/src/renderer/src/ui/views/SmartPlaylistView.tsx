import type { Track } from "@musex/core";
import { downloadRecordFor, SMART_TITLES, type SmartKind } from "@musex/core";
import { useEffect, useState } from "react";
import { useApp } from "../../state/app";
import { usePlayer } from "../../state/player";
import { useSelection } from "../../state/selection";
import { computeMix, useSmartMixes } from "../../state/smart-mixes";
import { ActionBar } from "../discovery/ActionBar";
import { useDownloadRecords } from "../hooks/useDownloadRecords";
import { NewPlaylistDialog } from "../NewPlaylistDialog";
import type { TrackMenuTarget } from "../TrackContextMenu";
import { TrackContextMenu } from "../TrackContextMenu";
import { TrackRow } from "../TrackRow";
import { VirtualTrackList } from "../VirtualTrackList";

const EMPTY_MESSAGES: Record<SmartKind, string> = {
  "for-you": "Play and rate more music first — For You builds on your listening history.",
  "top-rated": "Nothing here yet — rate tracks 4 stars or more and they'll show up.",
  "heavy-rotation": "Nothing here yet — keep listening and your most-played tracks will show up.",
  rediscover: "Nothing to rediscover yet — favorites you haven't played in a while land here.",
};

/** For You needs several round trips (taste → similar → albums → tracks). */
const LOADING_MESSAGES: Record<SmartKind, string> = {
  "for-you": "Mixing from your taste profile…",
  "top-rated": "Loading…",
  "heavy-rotation": "Loading…",
  rediscover: "Loading…",
};

type FetchState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ok"; tracks: Track[] };

export function SmartPlaylistView({ kind }: { kind: SmartKind }) {
  const { library } = useApp();
  const smartMixes = useSmartMixes();
  const downloadRecords = useDownloadRecords();
  const { state, playTracks, playTracksShuffled, playTrackNext } = usePlayer();
  const { selectedTrack, select } = useSelection();
  // Seed from the background-warmed cache so a ready mix renders instantly.
  const warmed = smartMixes.get(kind);
  const [fetch, setFetch] = useState<FetchState>(
    warmed ? { status: "ok", tracks: warmed } : { status: "loading" },
  );
  const [menu, setMenu] = useState<TrackMenuTarget | null>(null);
  const [newSeed, setNewSeed] = useState<string[] | null>(null);

  // If the warm completes (or refreshes) while this view is open, adopt it.
  useEffect(() => {
    if (warmed) setFetch({ status: "ok", tracks: warmed });
  }, [warmed]);

  useEffect(() => {
    if (!library) return;
    // Cache hit → no compute, no spinner; the warmed effect above keeps it fresh.
    if (smartMixes.get(kind)) return;
    let cancelled = false;
    setFetch({ status: "loading" });
    // Cold open (warm not done yet / failed): compute on open exactly as before,
    // via the shared helper the warm also uses.
    computeMix(kind, library)
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
  }, [library, kind, smartMixes]);

  const playingTrackId =
    state.queue != null ? (state.queue.tracks[state.queue.index]?.id ?? null) : null;

  return (
    <div className="tracks-view">
      <div className="tracks-view-header">
        <div className="browse-header">
          <h3 className="browse-title">{SMART_TITLES[kind]}</h3>
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

      {fetch.status === "loading" && (
        <div className="content-placeholder">{LOADING_MESSAGES[kind]}</div>
      )}

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
          downloadRecord={downloadRecordFor(downloadRecords, menu.track)}
          libraryId={library?.id ?? null}
        />
      )}

      {newSeed !== null && (
        <NewPlaylistDialog seedTrackIds={newSeed} onClose={() => setNewSeed(null)} />
      )}
    </div>
  );
}
