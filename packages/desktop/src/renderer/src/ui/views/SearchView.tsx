import type { SearchResults } from "@musex/core";
import { useEffect, useRef, useState } from "react";
import { useApp } from "../../state/app";
import { usePlayer } from "../../state/player";
import { AlbumArt } from "../AlbumArt";
import { NewPlaylistDialog } from "../NewPlaylistDialog";
import type { TrackMenuTarget } from "../TrackContextMenu";
import { TrackContextMenu } from "../TrackContextMenu";
import { TrackRow } from "../TrackRow";
import { VirtualTrackList } from "../VirtualTrackList";

const EMPTY: SearchResults = { artists: [], albums: [], tracks: [] };

export function SearchView() {
  const { library, dispatch } = useApp();
  const { state, playTracks } = usePlayer();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults>(EMPTY);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [menu, setMenu] = useState<TrackMenuTarget | null>(null);
  const [newSeed, setNewSeed] = useState<string[] | null>(null);

  // Focus the input on mount.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

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

  const playingTrackId =
    state.queue != null ? (state.queue.tracks[state.queue.index]?.id ?? null) : null;

  const hasQuery = query.trim() !== "";
  const empty =
    results.artists.length === 0 && results.albums.length === 0 && results.tracks.length === 0;

  return (
    <div className="search-page">
      <div className="search-bar">
        <span className="search-icon">🔍</span>
        <input
          ref={inputRef}
          className="search-input"
          type="text"
          placeholder="Search your library"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {!hasQuery && <div className="content-placeholder">Search artists, albums and songs.</div>}
      {hasQuery && loading && empty && <div className="content-placeholder">Searching…</div>}
      {hasQuery && !loading && empty && (
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
                onClick={() => dispatch({ type: "navigate", view: { name: "artist", artist } })}
              >
                <AlbumArt thumb={artist.thumb} className="grid-card-art artist-art" />
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
                onClick={() => dispatch({ type: "navigate", view: { name: "album", album } })}
              >
                <AlbumArt thumb={album.thumb} className="grid-card-art" />
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
                  onPlay={() => playTracks(results.tracks, index)}
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
        />
      )}

      {newSeed !== null && (
        <NewPlaylistDialog seedTrackIds={newSeed} onClose={() => setNewSeed(null)} />
      )}
    </div>
  );
}
