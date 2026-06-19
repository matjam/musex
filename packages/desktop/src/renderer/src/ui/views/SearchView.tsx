import type { SearchResults } from "@musex/core";
import {
  downloadRecordFor,
  entityRefForAlbum,
  entityRefForArtist,
  externalAlbumRef,
  externalArtistRef,
} from "@musex/core";
import { useEffect, useState } from "react";
import type { ExternalArtistResultDto, LastfmSearchDto } from "../../../../shared/ipc-contract";
import { useApp } from "../../state/app";
import { usePlayer } from "../../state/player";
import { useSelection } from "../../state/selection";
import { OFFLINE_ACTION_TOOLTIP, OFFLINE_VIEW_MESSAGE } from "../../util/offline";
import { GridCard } from "../GridCard";
import { useAcquisitionAvailable } from "../hooks/useAcquisitionAvailable";
import { useAlbumPlayActions } from "../hooks/useAlbumPlayActions";
import { useDownloadRecords } from "../hooks/useDownloadRecords";
import { NewPlaylistDialog } from "../NewPlaylistDialog";
import type { TrackMenuTarget } from "../TrackContextMenu";
import { TrackContextMenu } from "../TrackContextMenu";
import { TrackRow } from "../TrackRow";
import { VirtualTrackList } from "../VirtualTrackList";

const EMPTY: SearchResults = { artists: [], albums: [], tracks: [] };
const EMPTY_LASTFM: LastfmSearchDto = { artists: [], albums: [], tracks: [] };

export function SearchView() {
  // The query lives in app state (driven by the top-bar search box).
  const { library, dispatch, searchQuery: query, connectivity, searchNonce } = useApp();
  const offline = connectivity === "offline";
  const downloadRecords = useDownloadRecords();
  const { state, playTrackNext } = usePlayer();
  const { selectedTrack, select } = useSelection();
  const acquisitionAvailable = useAcquisitionAvailable();
  const { playAlbum: playAlbumFromTile } = useAlbumPlayActions();
  const [results, setResults] = useState<SearchResults>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [external, setExternal] = useState<ExternalArtistResultDto[]>([]);
  const [externalLoading, setExternalLoading] = useState(false);
  const [lastfm, setLastfm] = useState<LastfmSearchDto>(EMPTY_LASTFM);
  const [lastfmLoading, setLastfmLoading] = useState(false);
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
  // biome-ignore lint/correctness/useExhaustiveDependencies: searchNonce is a re-run trigger (Enter), not read in the body
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
  }, [query, acquisitionAvailable, offline, searchNonce]);

  // last.fm catalog search (artist + album + track). Independent debounced
  // fetch; needs the network so it's skipped offline. Returns empty when
  // last.fm isn't configured (no api key) — the section just stays hidden.
  // biome-ignore lint/correctness/useExhaustiveDependencies: searchNonce is a re-run trigger (Enter), not read in the body
  useEffect(() => {
    if (offline) {
      setLastfm(EMPTY_LASTFM);
      setLastfmLoading(false);
      return;
    }
    const q = query.trim();
    if (q === "") {
      setLastfm(EMPTY_LASTFM);
      setLastfmLoading(false);
      return;
    }
    setLastfmLoading(true);
    let cancelled = false;
    const handle = setTimeout(() => {
      window.musex
        .lastfmSearch(q)
        .then((r) => {
          if (!cancelled) {
            setLastfm(r);
            setLastfmLoading(false);
          }
        })
        .catch((err: unknown) => {
          console.error("[lastfm] search failed:", err);
          if (!cancelled) {
            setLastfm(EMPTY_LASTFM);
            setLastfmLoading(false);
          }
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [query, offline, searchNonce]);

  const playingTrackId =
    state.queue != null ? (state.queue.tracks[state.queue.index]?.id ?? null) : null;

  // External results duplicating a library artist hit are noise — hide them.
  const libraryArtistNames = new Set(results.artists.map((a) => a.name.toLowerCase()));
  const libraryAlbumTitles = new Set(results.albums.map((a) => a.title.trim().toLowerCase()));

  // Merged "Not in your library" artists: the acquisition plugin (Lidarr) +
  // last.fm, deduped by lowercased name (the same artist often surfaces in
  // both), and minus anything already owned. Acquisition results win on
  // collision (they carry providerId/providerRef → Follow-to-acquire works).
  type ExternalArtist = { name: string; imageUrl?: string };
  const seenArtists = new Set<string>();
  const externalArtists: ExternalArtist[] = [];
  for (const a of external) {
    const key = a.name.toLowerCase();
    if (libraryArtistNames.has(key) || seenArtists.has(key)) continue;
    seenArtists.add(key);
    externalArtists.push({ name: a.name, ...(a.imageUrl ? { imageUrl: a.imageUrl } : {}) });
  }
  for (const a of lastfm.artists) {
    const key = a.name.toLowerCase();
    if (libraryArtistNames.has(key) || seenArtists.has(key)) continue;
    seenArtists.add(key);
    externalArtists.push({ name: a.name, ...(a.imageUrl ? { imageUrl: a.imageUrl } : {}) });
  }

  // last.fm albums minus owned (same title case-insensitive).
  const externalAlbums = lastfm.albums.filter(
    (a) => !libraryAlbumTitles.has(a.title.trim().toLowerCase()),
  );
  // last.fm tracks: external tracks aren't playable/acquirable, so each just
  // navigates to its artist (to Follow / acquire). Owned tracks aren't deduped
  // out — the label makes clear it's a jump to the artist, not the track.
  const externalTracks = lastfm.tracks;

  const hasExternal =
    externalArtists.length > 0 || externalAlbums.length > 0 || externalTracks.length > 0;

  const hasQuery = query.trim() !== "";
  const empty =
    results.artists.length === 0 &&
    results.albums.length === 0 &&
    results.tracks.length === 0 &&
    !hasExternal;
  const anyLoading = loading || externalLoading || lastfmLoading;

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
                  onPlayAlbum={(mode) => void playAlbumFromTile(ref, mode)}
                  playActionsDisabled={offline}
                  playActionsTitle={offline ? OFFLINE_ACTION_TOOLTIP : undefined}
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

      {hasQuery && offline && (
        <div className="browse-section">
          <h3 className="browse-title">Not in your library</h3>
          <div className="content-placeholder">{OFFLINE_VIEW_MESSAGE}</div>
        </div>
      )}

      {!offline && hasExternal && (
        <div className="browse-section">
          <h3 className="browse-title">Not in your library</h3>
          <div className="browse-sub">
            From Last.fm and your acquisition plugin — open to Follow
          </div>

          {externalArtists.length > 0 && (
            <>
              <h4 className="browse-subtitle">Artists</h4>
              <div className="browse-grid">
                {externalArtists.map((artist) => (
                  <GridCard
                    key={`artist:${artist.name.toLowerCase()}`}
                    round
                    thumb={artist.imageUrl}
                    title={artist.name}
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
            </>
          )}

          {externalAlbums.length > 0 && (
            <>
              <h4 className="browse-subtitle">Albums</h4>
              <div className="browse-grid">
                {externalAlbums.map((album) => {
                  const ref = externalAlbumRef(album.title, album.artistName);
                  return (
                    <GridCard
                      key={`album:${album.artistName.toLowerCase()}:${album.title.toLowerCase()}`}
                      thumb={album.imageUrl}
                      title={album.title}
                      subtitle={album.artistName}
                      entity={ref}
                      onOpen={() => dispatch({ type: "navigate", view: { name: "album", ref } })}
                    />
                  );
                })}
              </div>
            </>
          )}

          {externalTracks.length > 0 && (
            <>
              <h4 className="browse-subtitle">Songs</h4>
              <div className="search-external-tracks">
                {externalTracks.map((track) => {
                  const ref = externalArtistRef(track.artistName);
                  // External tracks aren't playable/acquirable — navigate to
                  // the artist page (to Follow / acquire). Labelled so it's clear.
                  return (
                    <button
                      type="button"
                      key={`track:${track.artistName.toLowerCase()}:${track.title.toLowerCase()}`}
                      className="search-external-track"
                      onClick={() => dispatch({ type: "navigate", view: { name: "artist", ref } })}
                    >
                      <span className="search-external-track-title">{track.title}</span>
                      <span className="search-external-track-sub">
                        {track.artistName} · go to artist
                      </span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
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
