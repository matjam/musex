import {
  Compass,
  Disc3,
  Download,
  Flame,
  History,
  Home,
  ListMusic,
  Mic2,
  Music,
  Settings,
  Star,
} from "lucide-react";
import type { SmartKind } from "../../../logic/smart-playlists";
import { SMART_TITLES } from "../../../logic/smart-playlists";
import { useApp } from "../state/app";
import { usePlaylists } from "../state/playlists";
import { useSimilar } from "../state/similar";
import { SimilarPanel } from "./SimilarPanel";
import { TrackDetailPanel } from "./TrackDetailPanel";
import { AlbumDetailView } from "./views/AlbumDetailView";
import { AlbumsView } from "./views/AlbumsView";
import { ArtistDetailView } from "./views/ArtistDetailView";
import { ArtistsView } from "./views/ArtistsView";
import { DiscoverView } from "./views/DiscoverView";
import { DownloadsView } from "./views/DownloadsView";
import { ExternalArtistView } from "./views/ExternalArtistView";
import { HomeView } from "./views/HomeView";
import { PlaylistView } from "./views/PlaylistView";
import { SearchView } from "./views/SearchView";
import { SettingsView } from "./views/SettingsView";
import { SmartPlaylistView } from "./views/SmartPlaylistView";
import { TracksView } from "./views/TracksView";

/** Sidebar entries for the Smart section, in display order. */
const SMART_NAV: { kind: SmartKind; Icon: typeof Star }[] = [
  { kind: "top-rated", Icon: Star },
  { kind: "heavy-rotation", Icon: Flame },
  { kind: "rediscover", Icon: History },
];

export function Shell() {
  const { library, view, dispatch } = useApp();
  const { playlists } = usePlaylists();
  const { target: similarTarget } = useSimilar();

  const serverLabel = library ? `${library.serverName} · ${library.title}` : "No library";

  // Determine which nav item is visually active.
  // artist/album drill-downs keep the Artists nav highlighted.
  const homeActive = view.name === "home";
  const discoverActive = view.name === "discover";
  const downloadsActive = view.name === "downloads";
  const artistsActive = view.name === "artists" || view.name === "artist" || view.name === "album";
  const albumsActive = view.name === "albums";
  const tracksActive = view.name === "tracks";
  const settingsActive = view.name === "settings";

  function renderContent() {
    switch (view.name) {
      case "home":
        return <HomeView />;
      case "discover":
        return <DiscoverView />;
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
      case "smart":
        return <SmartPlaylistView kind={view.kind} />;
      case "external-artist":
        return <ExternalArtistView artistName={view.artistName} />;
      case "downloads":
        return <DownloadsView />;
    }
  }

  return (
    <div className="app-body">
      <nav className="sidebar">
        <button
          type="button"
          className={`nav-item${homeActive ? " active" : ""}`}
          onClick={() => dispatch({ type: "navigate", view: { name: "home" } })}
        >
          <Home size={16} />
          Home
        </button>

        <button
          type="button"
          className={`nav-item${discoverActive ? " active" : ""}`}
          onClick={() => dispatch({ type: "navigate", view: { name: "discover" } })}
        >
          <Compass size={16} />
          Discover
        </button>

        <button
          type="button"
          className={`nav-item${downloadsActive ? " active" : ""}`}
          onClick={() => dispatch({ type: "navigate", view: { name: "downloads" } })}
        >
          <Download size={16} />
          Downloads
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

        <div className="nav-section">Smart</div>

        {SMART_NAV.map(({ kind, Icon }) => (
          <button
            key={kind}
            type="button"
            className={`nav-item${view.name === "smart" && view.kind === kind ? " active" : ""}`}
            onClick={() => dispatch({ type: "navigate", view: { name: "smart", kind } })}
          >
            <Icon size={16} />
            {SMART_TITLES[kind]}
          </button>
        ))}

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

      {/* Similar takes priority over the track panel; closing it restores the
          track panel when a selection exists. */}
      {similarTarget ? <SimilarPanel /> : <TrackDetailPanel />}
    </div>
  );
}
