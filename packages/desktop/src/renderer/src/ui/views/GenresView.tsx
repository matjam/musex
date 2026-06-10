import { useEffect, useState } from "react";
import { type GenreEntry, genreIndex } from "../../../../logic/genres";
import { listValidator } from "../../../../shared/list-validator";
import { useApp } from "../../state/app";

type FetchState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ok"; genres: GenreEntry[] };

export function GenresView() {
  const { library, dispatch } = useApp();
  const [fetch, setFetch] = useState<FetchState>({ status: "loading" });

  useEffect(() => {
    if (!library) return;
    const id = library.id;
    const validator = listValidator(library.updatedAt);
    let cancelled = false;
    setFetch({ status: "loading" });
    window.musex
      .listAllAlbums(id, "title", validator)
      .then((albums) => {
        if (!cancelled) setFetch({ status: "ok", genres: genreIndex(albums) });
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setFetch({
            status: "error",
            message: err instanceof Error ? err.message : "Failed to load genres",
          });
      });
    return () => {
      cancelled = true;
    };
  }, [library]);

  if (fetch.status === "loading") {
    return <div className="content-placeholder">Loading genres…</div>;
  }

  if (fetch.status === "error") {
    return <div className="content-placeholder error-text">Error: {fetch.message}</div>;
  }

  const { genres } = fetch;

  if (genres.length === 0) {
    return (
      <div className="content-placeholder">
        No genres found — your albums have no genre tags in Plex.
      </div>
    );
  }

  return (
    <div className="browse-section">
      <div className="browse-header">
        <h3 className="browse-title">Genres</h3>
      </div>
      <div className="browse-sub">
        {genres.length} genre{genres.length !== 1 ? "s" : ""}
      </div>
      <div className="genre-grid">
        {genres.map(({ genre, albumCount }) => (
          <button
            key={genre.toLowerCase()}
            type="button"
            className="genre-card"
            onClick={() => dispatch({ type: "navigate", view: { name: "genre", genre } })}
          >
            <div className="genre-card-name">{genre}</div>
            <div className="genre-card-count">
              {albumCount} album{albumCount !== 1 ? "s" : ""}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
