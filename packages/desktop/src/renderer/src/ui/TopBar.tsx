import { ChevronLeft, ChevronRight, Menu as MenuIcon, Search, WifiOff } from "lucide-react";
import { useApp } from "../state/app";

// Non-mac windows are frameless, so the File/Edit/View/Help menu has no
// visible menu bar; a hamburger pops it up. macOS keeps its native menu bar.
const isMac = window.musex.platform === "darwin";

/**
 * Persistent top bar. The whole bar is a macOS drag region (so the window can be
 * moved by grabbing it); interactive children opt out with `-webkit-app-region:
 * no-drag`. Left padding clears the traffic-light window controls. Hosts the
 * back/forward history buttons and the always-visible search box (Spotify-style).
 */
export function TopBar() {
  const { searchQuery, history, connectivity, dispatch } = useApp();

  return (
    <header className="topbar">
      {!isMac && (
        <button
          type="button"
          className="topbar-menu-btn"
          title="Menu"
          aria-label="Menu"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            void window.musex.popupMenu(r.left, r.bottom);
          }}
        >
          <MenuIcon size={18} />
        </button>
      )}
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
          onKeyDown={(e) => {
            // Enter re-runs the search even when the text is unchanged.
            if (e.key === "Enter") {
              e.preventDefault();
              dispatch({ type: "search-now" });
            }
          }}
          aria-label="Search your library"
        />
      </div>
      {connectivity === "offline" && (
        <div className="topbar-offline-pill">
          <WifiOff size={12} />
          Offline
        </div>
      )}
    </header>
  );
}
