import { Disc3, Home, ListMusic, Mic2, Music, Search, Settings } from "lucide-react";
import { useApp } from "../state/app";
import { usePlaylists } from "../state/playlists";
import { AlbumDetailView } from "./views/AlbumDetailView";
import { AlbumsView } from "./views/AlbumsView";
import { ArtistDetailView } from "./views/ArtistDetailView";
import { ArtistsView } from "./views/ArtistsView";
import { PlaylistView } from "./views/PlaylistView";
import { SearchView } from "./views/SearchView";
import { SettingsView } from "./views/SettingsView";
import { TracksView } from "./views/TracksView";

export function Shell() {
  const { library, view, dispatch } = useApp();
  const { playlists } = usePlaylists();

  const serverLabel = library ? `${library.serverName} · ${library.title}` : "No library";

  // Determine which nav item is visually active.
  // artist/album drill-downs keep the Artists nav highlighted.
  const artistsActive = view.name === "artists" || view.name === "artist" || view.name === "album";
  const albumsActive = view.name === "albums";
  const tracksActive = view.name === "tracks";
  const settingsActive = view.name === "settings";
  const searchActive = view.name === "search";

  function renderContent() {
    switch (view.name) {
      case "artists":
        return <ArtistsView />;
      case "artist":
        return <ArtistDetailView artist={view.artist} />;
      case "album":
        return <AlbumDetailView album={view.album} />;
      case "albums":
        return <AlbumsView />;
      case "settings":
        return <SettingsView />;
      case "search":
        return <SearchView />;
      case "tracks":
        return <TracksView />;
      case "playlist":
        return <PlaylistView playlist={view.playlist} />;
    }
  }

  return (
    <div className="app-body">
      <nav className="sidebar">
        <div className="sidebar-logo brand">
          mus<span>ex</span>
        </div>

        <div className="nav-item dim">
          <Home size={16} />
          Home
        </div>
        <button
          type="button"
          className={`nav-item${searchActive ? " active" : ""}`}
          onClick={() => dispatch({ type: "navigate", view: { name: "search" } })}
        >
          <Search size={16} />
          Search
        </button>

        <div className="nav-section">Library</div>

        <button
          type="button"
          className={`nav-item${albumsActive ? " active" : ""}`}
          onClick={() => dispatch({ type: "navigate", view: { name: "albums" } })}
        >
          <Disc3 size={16} />
          Albums
        </button>

        <button
          type="button"
          className={`nav-item${artistsActive ? " active" : ""}`}
          onClick={() => dispatch({ type: "navigate", view: { name: "artists" } })}
        >
          <Mic2 size={16} />
          Artists
        </button>

        <button
          type="button"
          className={`nav-item${tracksActive ? " active" : ""}`}
          onClick={() => dispatch({ type: "navigate", view: { name: "tracks" } })}
        >
          <Music size={16} />
          Tracks
        </button>

        <div className="playlist-rail">
          <div className="playlist-rail-head">
            <ListMusic size={14} />
            <span>Playlists</span>
          </div>
          {playlists.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`nav-item${view.name === "playlist" && view.playlist.id === p.id ? " active" : ""}`}
              onClick={() =>
                dispatch({ type: "navigate", view: { name: "playlist", playlist: p } })
              }
            >
              {p.title}
            </button>
          ))}
        </div>

        <div className="nav-section">App</div>

        <button
          type="button"
          className={`nav-item${settingsActive ? " active" : ""}`}
          onClick={() => dispatch({ type: "navigate", view: { name: "settings" } })}
        >
          <Settings size={16} />
          Settings
        </button>

        <div className="lib-switch">
          <div className="lib-switch-label">Plex Library</div>
          {serverLabel} ▾
        </div>
      </nav>

      <main className="content-area">{renderContent()}</main>
    </div>
  );
}
