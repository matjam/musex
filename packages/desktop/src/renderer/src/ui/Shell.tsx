import { useApp } from "../state/app";
import { usePlaylists } from "../state/playlists";
import { AlbumDetailView } from "./views/AlbumDetailView";
import { ArtistDetailView } from "./views/ArtistDetailView";
import { ArtistsView } from "./views/ArtistsView";
import { PlaylistView } from "./views/PlaylistView";
import { SearchView } from "./views/SearchView";
import { SettingsView } from "./views/SettingsView";

export function Shell() {
  const { library, view, dispatch } = useApp();
  const { playlists } = usePlaylists();

  const serverLabel = library ? `${library.serverName} · ${library.title}` : "No library";

  // Determine which nav item is visually active.
  // artist/album drill-downs keep the Artists nav highlighted.
  const artistsActive = view.name === "artists" || view.name === "artist" || view.name === "album";
  const albumsActive = view.name === "albums";
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
        // Albums as a flat all-library grid is deferred (would require a slow
        // flatten-all-albums fetch). Redirect to Artists instead.
        return <ArtistsView />;
      case "settings":
        return <SettingsView />;
      case "search":
        return <SearchView />;
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
          <span className="nav-ic" />
          Home
        </div>
        <button
          type="button"
          className={`nav-item${searchActive ? " active" : ""}`}
          onClick={() => dispatch({ type: "navigate", view: { name: "search" } })}
        >
          <span className="nav-ic" />
          Search
        </button>

        <div className="nav-section">Library</div>

        <button
          type="button"
          className={`nav-item${albumsActive ? " active" : ""} dim`}
          onClick={() => dispatch({ type: "navigate", view: { name: "artists" } })}
        >
          <span className="nav-ic" />
          Albums
        </button>

        <button
          type="button"
          className={`nav-item${artistsActive ? " active" : ""}`}
          onClick={() => dispatch({ type: "navigate", view: { name: "artists" } })}
        >
          <span className="nav-ic" />
          Artists
        </button>

        <div className="nav-item dim">
          <span className="nav-ic" />
          Tracks
        </div>

        <div className="playlist-rail">
          <div className="playlist-rail-head">
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
          <span className="nav-ic" />
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
