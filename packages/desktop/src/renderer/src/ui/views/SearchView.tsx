import type { SearchResults } from "@musex/core";
import {
  downloadRecordFor,
  entityRefForAlbum,
  entityRefForArtist,
  externalArtistRef,
} from "@musex/core";
import { Download } from "lucide-react";
import { useEffect, useState } from "react";
import type { ExternalArtistResultDto } from "../../../../shared/ipc-contract";
import { useApp } from "../../state/app";
import { useMonitoring } from "../../state/monitoring";
import { usePlayer } from "../../state/player";
import { useSelection } from "../../state/selection";
import { OFFLINE_VIEW_MESSAGE } from "../../util/offline";
import { AlbumArt } from "../AlbumArt";
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
  const { library, dispatch, searchQuery: query, connectivity } = useApp();
  const offline = connectivity === "offline";
  const downloadRecords = useDownloadRecords();
  const { state, playTrackNext } = usePlayer();
  const { selectedTrack, select } = useSelection();
  const monitoring = useMonitoring();
  const acquisitionAvailable = useAcquisitionAvailable();
  const [results, setResults] = useState<SearchResults>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [external, setExternal] = useState<ExternalArtistResultDto[]>([]);
  const [externalLoading, setExternalLoading] = useState(false);
  const [menu, setMenu] = useState<TrackMenuTarget | null>(null);
  const [newSeed, setNewSeed] = useState<string[] | null>(null);

  // Debounced live search (~250ms). Blank query clears immediately.
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
  }, [query, library]);

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

  // Monitor via the precise providerRef, then refresh the live monitoring
  // store so the marker lights up (the plugin itself toasts success/failure).
  function monitorArtist(artist: ExternalArtistResultDto) {
    window.musex
      .acquisitionAcquireArtist({ providerId: artist.providerId, providerRef: artist.providerRef })
      .then(() => monitoring.refresh())
      .catch((err: unknown) => {
        console.error("[acquisition] acquireArtist failed:", err);
      });
  }

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
            {results.artists.map((artist) => (
              <button
                type="button"
                key={artist.id}
                className="grid-card"
                onClick={() =>
                  dispatch({
                    type: "navigate",
                    view: { name: "artist", ref: entityRefForArtist(artist) },
                  })
                }
              >
                <AlbumArt
                  thumb={artist.thumb}
                  className="grid-card-art artist-art"
                  label={artist.name}
                  kind="artist"
                />
                <div className="grid-card-title">{artist.name}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {results.albums.length > 0 && (
        <div className="browse-section">
          <h3 className="browse-title">Albums</h3>
          <div className="browse-grid">
            {results.albums.map((album) => (
              <button
                type="button"
                key={album.id}
                className="grid-card"
                onClick={() =>
                  dispatch({
                    type: "navigate",
                    view: { name: "album", ref: entityRefForAlbum(album) },
                  })
                }
              >
                <AlbumArt
                  thumb={album.thumb}
                  className="grid-card-art"
                  label={album.title}
                  kind="album"
                />
                <div className="grid-card-title">{album.title}</div>
                {album.year != null && <div className="grid-card-sub">{album.year}</div>}
              </button>
            ))}
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
          <div className="browse-sub">via your acquisition plugin — monitor to download</div>
          <div className="browse-grid">
            {externalArtists.map((artist) => {
              const monitored = monitoring.isMonitored(artist.name);
              return (
                <GridCard
                  key={`${artist.providerId}:${artist.providerRef}`}
                  round
                  thumb={artist.imageUrl}
                  title={artist.name}
                  subtitle={artist.disambiguation}
                  monitored={monitored}
                  onOpen={() =>
                    dispatch({
                      type: "navigate",
                      view: { name: "artist", ref: externalArtistRef(artist.name) },
                    })
                  }
                  actionIcon={monitored ? undefined : Download}
                  actionTitle="Monitor artist — download everything"
                  onAction={monitored ? undefined : () => monitorArtist(artist)}
                />
              );
            })}
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
