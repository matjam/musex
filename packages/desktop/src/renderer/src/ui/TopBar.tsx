import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { useApp } from "../state/app";

/**
 * Persistent top bar. The whole bar is a macOS drag region (so the window can be
 * moved by grabbing it); interactive children opt out with `-webkit-app-region:
 * no-drag`. Left padding clears the traffic-light window controls. Hosts the
 * back/forward history buttons and the always-visible search box (Spotify-style).
 */
export function TopBar() {
  const { searchQuery, history, dispatch } = useApp();

  return (
    <header className="topbar">
      <div className="topbar-logo brand">
        mus<span>ex</span>
      </div>
      <div className="topbar-nav">
        <button
          type="button"
          className="topbar-nav-btn"
          title="Back (⌘[)"
          aria-label="Back"
          disabled={history.back.length === 0}
          onClick={() => dispatch({ type: "nav-back" })}
        >
          <ChevronLeft size={18} />
        </button>
        <button
          type="button"
          className="topbar-nav-btn"
          title="Forward (⌘])"
          aria-label="Forward"
          disabled={history.forward.length === 0}
          onClick={() => dispatch({ type: "nav-forward" })}
        >
          <ChevronRight size={18} />
        </button>
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
