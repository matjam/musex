import {
  ChevronDown,
  ChevronRight,
  Compass,
  Disc3,
  Download,
  Flame,
  History,
  Home,
  Mic2,
  Music,
  Sparkles,
  Star,
  Tags,
  Wand2,
} from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import type { SmartKind } from "../../../logic/smart-playlists";
import { SMART_TITLES } from "../../../logic/smart-playlists";
import { useApp } from "../state/app";
import { usePlaylists } from "../state/playlists";
import { SidePanelHost } from "./SidePanel";
import { AlbumDetailView } from "./views/AlbumDetailView";
import { AlbumsView } from "./views/AlbumsView";
import { ArtistDetailView } from "./views/ArtistDetailView";
import { ArtistsView } from "./views/ArtistsView";
import { DiscoverView } from "./views/DiscoverView";
import { DownloadsView } from "./views/DownloadsView";
import { ExternalArtistView } from "./views/ExternalArtistView";
import { GenresView } from "./views/GenresView";
import { GenreView } from "./views/GenreView";
import { HomeView } from "./views/HomeView";
import { MixesView } from "./views/MixesView";
import { MixView } from "./views/MixView";
import { PlaylistView } from "./views/PlaylistView";
import { SearchView } from "./views/SearchView";
import { SettingsView } from "./views/SettingsView";
import { SimilarView } from "./views/SimilarView";
import { SmartPlaylistView } from "./views/SmartPlaylistView";
import { TracksView } from "./views/TracksView";

/** Sidebar entries for the Smart section, in display order. */
const SMART_NAV: { kind: SmartKind; Icon: typeof Star }[] = [
  { kind: "for-you", Icon: Wand2 },
  { kind: "top-rated", Icon: Star },
  { kind: "heavy-rotation", Icon: Flame },
  { kind: "rediscover", Icon: History },
];

/** Collapsed state per sidebar section, persisted across launches.
 *  localStorage (not main-process settings) — pure UI state. */
function useCollapsed(key: string): [boolean, () => void] {
  const storageKey = `musex.sidebar.${key}`;
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(storageKey) === "1");
  const toggle = () =>
    setCollapsed((c) => {
      const next = !c;
      localStorage.setItem(storageKey, next ? "1" : "0");
      return next;
    });
  return [collapsed, toggle];
}

function SidebarSection({
  title,
  collapsed,
  onToggle,
  children,
}: {
  title: string;
  collapsed: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <>
      <button type="button" className="nav-section nav-section-toggle" onClick={onToggle}>
        {collapsed ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
        {title}
      </button>
      {!collapsed && children}
    </>
  );
}

export function Shell() {
  const { library, view, dispatch } = useApp();
  const { playlists } = usePlaylists();
  const [libraryCollapsed, toggleLibrary] = useCollapsed("library");
  const [smartCollapsed, toggleSmart] = useCollapsed("smart");
  const [playlistsCollapsed, togglePlaylists] = useCollapsed("playlists");

  const serverLabel = library ? `${library.serverName} · ${library.title}` : "No library";

  // Determine which nav item is visually active.
  // artist/album drill-downs keep the Artists nav highlighted.
  const homeActive = view.name === "home";
  const discoverActive = view.name === "discover";
  // The per-mix drill-down keeps the Mixes nav highlighted.
  const mixesActive = view.name === "mixes" || view.name === "mix";
  const downloadsActive = view.name === "downloads";
  const artistsActive = view.name === "artists" || view.name === "artist" || view.name === "album";
  const albumsActive = view.name === "albums";
  // The per-genre drill-down keeps the Genres nav highlighted.
  const genresActive = view.name === "genres" || view.name === "genre";
  const tracksActive = view.name === "tracks";

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
      case "genres":
        return <GenresView />;
      case "genre":
        return <GenreView genre={view.genre} />;
      case "mixes":
        return <MixesView />;
      case "mix":
        return <MixView mixId={view.mixId} />;
      case "tracks":
        return <TracksView />;
      case "playlist":
        return <PlaylistView playlist={view.playlist} />;
      case "smart":
        return <SmartPlaylistView kind={view.kind} />;
      case "external-artist":
        return <ExternalArtistView artistName={view.artistName} />;
      case "similar":
        return <SimilarView target={view.target} />;
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
          className={`nav-item${mixesActive ? " active" : ""}`}
          onClick={() => dispatch({ type: "navigate", view: { name: "mixes" } })}
        >
          <Sparkles size={16} />
          Mixes
        </button>

        <button
          type="button"
          className={`nav-item${downloadsActive ? " active" : ""}`}
          onClick={() => dispatch({ type: "navigate", view: { name: "downloads" } })}
        >
          <Download size={16} />
          Downloads
        </button>

        <SidebarSection title="Library" collapsed={libraryCollapsed} onToggle={toggleLibrary}>
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
            className={`nav-item${genresActive ? " active" : ""}`}
            onClick={() => dispatch({ type: "navigate", view: { name: "genres" } })}
          >
            <Tags size={16} />
            Genres
          </button>

          <button
            type="button"
            className={`nav-item${tracksActive ? " active" : ""}`}
            onClick={() => dispatch({ type: "navigate", view: { name: "tracks" } })}
          >
            <Music size={16} />
            Tracks
          </button>
        </SidebarSection>

        <SidebarSection title="Smart" collapsed={smartCollapsed} onToggle={toggleSmart}>
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
        </SidebarSection>

        <SidebarSection title="Playlists" collapsed={playlistsCollapsed} onToggle={togglePlaylists}>
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
        </SidebarSection>

        <div className="lib-switch">
          <div className="lib-switch-label">Plex Library</div>
          {serverLabel} ▾
        </div>
      </nav>

      <main className="content-area">{renderContent()}</main>

      <SidePanelHost />
    </div>
  );
}
