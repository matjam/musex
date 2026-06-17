import type { Track } from "@musex/core";
import { albumsForMix, composeMoodMix, listValidator, MOOD_MIXES, sampleThumbs } from "@musex/core";
import { useEffect, useState } from "react";
import { useApp } from "../../state/app";
import { usePlayer } from "../../state/player";
import { useSelection } from "../../state/selection";
import { downloadRecordFor } from "../../util/downloaded-records";
import { CardCollage } from "../CardCollage";
import { ActionBar } from "../discovery/ActionBar";
import { useDownloadRecords } from "../hooks/useDownloadRecords";
import { NewPlaylistDialog } from "../NewPlaylistDialog";
import type { TrackMenuTarget } from "../TrackContextMenu";
import { TrackContextMenu } from "../TrackContextMenu";
import { TrackRow } from "../TrackRow";
import { VirtualTrackList } from "../VirtualTrackList";

type FetchState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ok"; tracks: Track[]; thumbs: string[] };

/** One curated mood mix: keyword-matched library tracks, taste-ordered. */
export function MixView({ mixId }: { mixId: string }) {
  const { library, dispatch } = useApp();
  const downloadRecords = useDownloadRecords();
  const { state, playTracks, playTracksShuffled, playTrackNext } = usePlayer();
  const { selectedTrack, select } = useSelection();
  const [fetch, setFetch] = useState<FetchState>({ status: "loading" });
  const [menu, setMenu] = useState<TrackMenuTarget | null>(null);
  const [newSeed, setNewSeed] = useState<string[] | null>(null);

  const mix = MOOD_MIXES.find((m) => m.id === mixId) ?? null;

  // Unknown mix id (stale persisted view, bad link) — bounce home, where the
  // Smart Mixes now live.
  useEffect(() => {
    if (mix === null) dispatch({ type: "navigate", view: { name: "home" } });
  }, [mix, dispatch]);

  useEffect(() => {
    if (!library || mix === null) return;
    const id = library.id;
    const validator = listValidator(library.updatedAt);
    let cancelled = false;
    setFetch({ status: "loading" });
    Promise.all([
      window.musex.listAllAlbums(id, "title", validator),
      window.musex.listAllTracks(id, "title", validator),
      window.musex.getTasteSnapshot(),
    ])
      .then(([albums, tracks, snapshot]) => {
        if (cancelled) return;
        const stats = new Map(
          snapshot.stats.map((s) => [
            s.key,
            { plays: s.plays, skips: s.skips, ratingStars: s.ratingStars },
          ]),
        );
        setFetch({
          status: "ok",
          tracks: composeMoodMix(mix, albums, tracks, stats, snapshot.topArtists),
          thumbs: sampleThumbs(
            albumsForMix(mix, albums).map((a) => a.thumb),
            4,
            mix.id,
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
  }, [library, mix]);

  if (mix === null) return null;

  const playingTrackId =
    state.queue != null ? (state.queue.tracks[state.queue.index]?.id ?? null) : null;

  return (
    <div className="tracks-view">
      <div className="breadcrumb">
        <button
          type="button"
          className="breadcrumb-link"
          onClick={() => dispatch({ type: "navigate", view: { name: "home" } })}
        >
          Smart Mixes
        </button>
        {" › "}
        <span className="breadcrumb-current">{mix.title}</span>
      </div>

      <div className="tracks-view-header">
        <div className="browse-header">
          <div className="header-with-collage">
            {fetch.status === "ok" && (
              <CardCollage thumbs={fetch.thumbs} className="header-collage" />
            )}
            <h3 className="browse-title">{mix.title}</h3>
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
        <div className="browse-sub">
          {mix.description}
          {fetch.status === "ok" &&
            ` — ${fetch.tracks.length} track${fetch.tracks.length !== 1 ? "s" : ""}`}
        </div>
      </div>

      {fetch.status === "loading" && <div className="content-placeholder">Mixing…</div>}

      {fetch.status === "error" && (
        <div className="content-placeholder error-text">Error: {fetch.message}</div>
      )}

      {fetch.status === "ok" && fetch.tracks.length === 0 && (
        <div className="content-placeholder">
          No tracks matched this mix — your library's genre/mood tags may be sparse.
        </div>
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
