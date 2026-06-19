import type { SearchResults } from "@musex/core";
import {
  downloadRecordFor,
  entityRefForAlbum,
  entityRefForArtist,
  externalArtistRef,
} from "@musex/core";
import { useEffect, useState } from "react";
import type { ExternalArtistResultDto } from "../../../../shared/ipc-contract";
import { useApp } from "../../state/app";
import { usePlayer } from "../../state/player";
import { useSelection } from "../../state/selection";
import { OFFLINE_VIEW_MESSAGE } from "../../util/offline";
import { GridCard } from "../GridCard";
import { useAcquisitionAvailable } from "../hooks/useAcquisitionAvailable";
import { useDownloadRecords } from "../hooks/useDownloadRecords";
import { NewPlaylistDialog } from "../NewPlaylistDialog";
import type { TrackMenuTarget } from "../TrackContextMenu";
import { TrackContextMenu } from "../TrackContextMenu";
import { TrackRow } from "../TrackRow";
import { VirtualTrackList } from "../VirtualTrackList";

const EMPTY: SearchResults = { artists: [], albums: [], tracks: [] };

export function SearchView() {
  // The query lives in app state (driven by the top-bar search box).
  const { library, dispatch, searchQuery: query, connectivity, searchNonce } = useApp();
  const offline = connectivity === "offline";
  const downloadRecords = useDownloadRecords();
  const { state, playTrackNext } = usePlayer();
  const { selectedTrack, select } = useSelection();
  const acquisitionAvailable = useAcquisitionAvailable();
  const [results, setResults] = useState<SearchResults>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [external, setExternal] = useState<ExternalArtistResultDto[]>([]);
  const [externalLoading, setExternalLoading] = useState(false);
  const [menu, setMenu] = useState<TrackMenuTarget | null>(null);
  const [newSeed, setNewSeed] = useState<string[] | null>(null);

  // Debounced live search (~250ms). Blank query clears immediately.
  // biome-ignore lint/correctness/useExhaustiveDependencies: searchNonce is a re-run trigger (Enter), not read in the body
  useEffect(() => {
    if (!library) return;
    const q = query.trim();
    if (q === "") {
      setResults(EMPTY);
      setLoading(false);
      return;
    }
    setLoading(true);
    const libraryId = library.id;
    let cancelled = false;
    const handle = setTimeout(() => {
      window.musex
        .search(libraryId, q)
        .then((r) => {
          if (!cancelled) {
            setResults(r);
            setLoading(false);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setResults(EMPTY);
            setLoading(false);
          }
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [query, library, searchNonce]);

  // Federated external search (acquisition plugin) — a second
  // debounced fetch, independent loading flag, never blocks library results.
  // Skipped entirely when offline: the lookup needs the network, and the
  // section is replaced by the offline message below.
  useEffect(() => {
    if (!acquisitionAvailable || offline) {
      setExternal([]);
      setExternalLoading(false);
      return;
    }
    const q = query.trim();
    if (q === "") {
      setExternal([]);
      setExternalLoading(false);
      return;
    }
    setExternalLoading(true);
    let cancelled = false;
    const handle = setTimeout(() => {
      window.musex
        .acquisitionSearchArtists(q)
        .then((r) => {
          if (!cancelled) {
            setExternal(r);
            setExternalLoading(false);
          }
        })
        .catch((err: unknown) => {
          console.error("[acquisition] searchArtists failed:", err);
          if (!cancelled) {
            setExternal([]);
            setExternalLoading(false);
          }
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [query, acquisitionAvailable, offline]);

  const playingTrackId =
    state.queue != null ? (state.queue.tracks[state.queue.index]?.id ?? null) : null;

  // External results duplicating a library artist hit are noise — hide them.
  const libraryArtistNames = new Set(results.artists.map((a) => a.name.toLowerCase()));
  const externalArtists = external.filter((a) => !libraryArtistNames.has(a.name.toLowerCase()));

  const hasQuery = query.trim() !== "";
  const empty =
    results.artists.length === 0 &&
    results.albums.length === 0 &&
    results.tracks.length === 0 &&
    externalArtists.length === 0;
  const anyLoading = loading || externalLoading;

  return (
    <div className="search-page">
      {!hasQuery && <div className="content-placeholder">Search artists, albums and songs.</div>}
      {hasQuery && anyLoading && empty && <div className="content-placeholder">Searching…</div>}
      {hasQuery && !anyLoading && empty && (
        <div className="content-placeholder">No results for "{query.trim()}".</div>
      )}

      {results.artists.length > 0 && (
        <div className="browse-section">
          <h3 className="browse-title">Artists</h3>
          <div className="browse-grid">
            {results.artists.map((artist) => {
              const ref = entityRefForArtist(artist);
              return (
                <GridCard
                  key={artist.id}
                  round
                  thumb={artist.thumb}
                  title={artist.name}
                  entity={ref}
                  onOpen={() => dispatch({ type: "navigate", view: { name: "artist", ref } })}
                />
              );
            })}
          </div>
        </div>
      )}

      {results.albums.length > 0 && (
        <div className="browse-section">
          <h3 className="browse-title">Albums</h3>
          <div className="browse-grid">
            {results.albums.map((album) => {
              const ref = entityRefForAlbum(album);
              return (
                <GridCard
                  key={album.id}
                  thumb={album.thumb}
                  title={album.title}
                  subtitle={album.year != null ? String(album.year) : undefined}
                  entity={ref}
                  onOpen={() => dispatch({ type: "navigate", view: { name: "album", ref } })}
                />
              );
            })}
          </div>
        </div>
      )}

      {results.tracks.length > 0 && (
        <div className="browse-section">
          <h3 className="browse-title">Songs</h3>
          <VirtualTrackList
            count={results.tracks.length}
            renderRow={(index) => {
              const track = results.tracks[index];
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
        </div>
      )}

      {hasQuery && offline && acquisitionAvailable && (
        <div className="browse-section">
          <h3 className="browse-title">Not in your library</h3>
          <div className="content-placeholder">{OFFLINE_VIEW_MESSAGE}</div>
        </div>
      )}

      {externalArtists.length > 0 && (
        <div className="browse-section">
          <h3 className="browse-title">Not in your library</h3>
          <div className="browse-sub">via your acquisition plugin — Follow to acquire</div>
          <div className="browse-grid">
            {externalArtists.map((artist) => (
              <GridCard
                key={`${artist.providerId}:${artist.providerRef}`}
                round
                thumb={artist.imageUrl}
                title={artist.name}
                subtitle={artist.disambiguation}
                entity={externalArtistRef(artist.name)}
                onOpen={() =>
                  dispatch({
                    type: "navigate",
                    view: { name: "artist", ref: externalArtistRef(artist.name) },
                  })
                }
              />
            ))}
          </div>
        </div>
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
