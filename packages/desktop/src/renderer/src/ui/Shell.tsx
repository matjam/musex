import { useApp } from "../state/app";

export function Shell() {
  const { library, view, dispatch } = useApp();

  const serverLabel = library ? `${library.serverName} · ${library.title}` : "No library";

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
        <div className="nav-item dim">
          <span className="nav-ic" />
          Search
        </div>

        <div className="nav-section">Library</div>

        <button
          type="button"
          className={`nav-item${view.name === "albums" ? " active" : ""}`}
          onClick={() => dispatch({ type: "navigate", view: { name: "albums" } })}
        >
          <span className="nav-ic" />
          Albums
        </button>

        <button
          type="button"
          className={`nav-item${view.name === "artists" ? " active" : ""}`}
          onClick={() => dispatch({ type: "navigate", view: { name: "artists" } })}
        >
          <span className="nav-ic" />
          Artists
        </button>

        <div className="nav-item dim">
          <span className="nav-ic" />
          Tracks
        </div>

        <div className="lib-switch">
          <div className="lib-switch-label">Plex Library</div>
          {serverLabel} ▾
        </div>
      </nav>

      <main className="content-area">
        <div className="content-placeholder">Select Albums or Artists to browse your library</div>
      </main>
    </div>
  );
}
