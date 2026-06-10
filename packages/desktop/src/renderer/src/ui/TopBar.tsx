import { Search } from "lucide-react";
import { useApp } from "../state/app";

/**
 * Persistent top bar. The whole bar is a macOS drag region (so the window can be
 * moved by grabbing it); interactive children opt out with `-webkit-app-region:
 * no-drag`. Left padding clears the traffic-light window controls. Hosts the
 * always-visible search box (Spotify-style).
 */
export function TopBar() {
  const { searchQuery, dispatch } = useApp();

  return (
    <header className="topbar">
      <div className="topbar-logo brand">
        mus<span>ex</span>
      </div>
      <div className="topbar-search">
        <Search size={16} className="topbar-search-icon" />
        <input
          id="topbar-search-input"
          className="topbar-search-input"
          type="text"
          placeholder="What do you want to listen to?"
          value={searchQuery}
          onChange={(e) => dispatch({ type: "set-search", query: e.target.value })}
          aria-label="Search your library"
        />
      </div>
    </header>
  );
}
