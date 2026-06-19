import { MOOD_MIXES, type SmartKind, smartTitle } from "@musex/core";
import {
  Activity,
  ChevronDown,
  ChevronRight,
  Compass,
  Disc3,
  HardDriveDownload,
  Home,
  Mic2,
  Music,
  Tags,
} from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { useApp } from "../state/app";
import { usePlaylists } from "../state/playlists";
import { SidePanelHost } from "./SidePanel";
import { MIX_ICONS, smartIcon } from "./smart-mix-icons";
import { ActivityView } from "./views/ActivityView";
import { AlbumsView } from "./views/AlbumsView";
import { AlbumView } from "./views/AlbumView";
import { ArtistsView } from "./views/ArtistsView";
import { ArtistView } from "./views/ArtistView";
import { DiscoverView } from "./views/DiscoverView";
import { GenresView } from "./views/GenresView";
import { GenreView } from "./views/GenreView";
import { HomeView } from "./views/HomeView";
import { MixView } from "./views/MixView";
import { OnDeviceView } from "./views/OnDeviceView";
import { PlaylistView } from "./views/PlaylistView";
import { SearchView } from "./views/SearchView";
import { SimilarView } from "./views/SimilarView";
import { SmartPlaylistView } from "./views/SmartPlaylistView";
import { TracksView } from "./views/TracksView";

/** Sidebar order for the smart playlists in the Smart Mixes section. */
const SMART_NAV: SmartKind[] = ["daily", "for-you", "top-rated", "heavy-rotation", "rediscover"];

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
  const onDeviceActive = view.name === "on-device";
  const activityActive = view.name === "activity";
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
        // One unified page for owned + external artists — no source split.
        return <ArtistView ref={view.ref} />;
      case "album":
        // One unified page for owned + external albums — no source split.
        return <AlbumView ref={view.ref} />;
      case "albums":
        return <AlbumsView />;
      case "search":
        return <SearchView />;
      case "genres":
        return <GenresView />;
      case "genre":
        return <GenreView genre={view.genre} />;
      case "mix":
        return <MixView mixId={view.mixId} />;
      case "tracks":
        return <TracksView />;
      case "playlist":
        return <PlaylistView playlist={view.playlist} />;
      case "smart":
        return <SmartPlaylistView kind={view.kind} />;
      case "similar":
        return <SimilarView target={view.target} />;
      case "on-device":
        return <OnDeviceView />;
      case "activity":
        // Recently-acquired (landed expansion albums, last 14 days) + the
        // taste-expansion bets feed. Reached from the persistent sidebar
        // "Activity" entry and ArtistsView's "View acquisition activity" link.
        return <ActivityView />;
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
          className={`nav-item${onDeviceActive ? " active" : ""}`}
          onClick={() => dispatch({ type: "navigate", view: { name: "on-device" } })}
        >
          <HardDriveDownload size={16} />
          On this device
        </button>

        <button
          type="button"
          className={`nav-item${activityActive ? " active" : ""}`}
          onClick={() => dispatch({ type: "navigate", view: { name: "activity" } })}
        >
          <Activity size={16} />
          Activity
        </button>

        <SidebarSection title="Library" collapsed={libraryCollapsed} onToggle={toggleLibrary}>
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
            className={`nav-item${albumsActive ? " active" : ""}`}
            onClick={() => dispatch({ type: "navigate", view: { name: "albums" } })}
          >
            <Disc3 size={16} />
            Albums
          </button>

          <button
            type="button"
            className={`nav-item${tracksActive ? " active" : ""}`}
            onClick={() => dispatch({ type: "navigate", view: { name: "tracks" } })}
          >
            <Music size={16} />
            Tracks
          </button>

          <button
            type="button"
            className={`nav-item${genresActive ? " active" : ""}`}
            onClick={() => dispatch({ type: "navigate", view: { name: "genres" } })}
          >
            <Tags size={16} />
            Genres
          </button>
        </SidebarSection>

        <SidebarSection title="Smart Mixes" collapsed={smartCollapsed} onToggle={toggleSmart}>
          {SMART_NAV.map((kind) => {
            const Icon = smartIcon(kind);
            return (
              <button
                key={kind}
                type="button"
                className={`nav-item${view.name === "smart" && view.kind === kind ? " active" : ""}`}
                onClick={() => dispatch({ type: "navigate", view: { name: "smart", kind } })}
              >
                <Icon size={16} />
                {smartTitle(kind)}
              </button>
            );
          })}
          {MOOD_MIXES.map((mix) => {
            const Icon = MIX_ICONS[mix.id] ?? Music;
            return (
              <button
                key={mix.id}
                type="button"
                className={`nav-item${view.name === "mix" && view.mixId === mix.id ? " active" : ""}`}
                onClick={() => dispatch({ type: "navigate", view: { name: "mix", mixId: mix.id } })}
              >
                <Icon size={16} />
                {mix.title}
              </button>
            );
          })}
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
              <span className="nav-label">{p.title}</span>
              <span className="nav-badge">{p.trackCount}</span>
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
