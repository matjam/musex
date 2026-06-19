import {
  albumsForGenre,
  albumsWithTrackGenres,
  type GenreEntry,
  genreIndex,
  listValidator,
  sampleThumbs,
} from "@musex/core";
import { useEffect, useState } from "react";
import { useApp } from "../../state/app";
import { CardCollage } from "../CardCollage";

type FetchState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ok"; genres: GenreEntry[]; thumbsByGenre: Map<string, string[]> };

export function GenresView() {
  const { library, dispatch } = useApp();
  const [fetch, setFetch] = useState<FetchState>({ status: "loading" });

  useEffect(() => {
    if (!library) return;
    const id = library.id;
    const validator = listValidator(library.updatedAt);
    let cancelled = false;
    setFetch({ status: "loading" });
    // Plex's bulk album list omits Genre tags for most albums, but the bulk
    // track list carries them — fold track genres up to the album level so the
    // index reflects the real library.
    Promise.all([
      window.musex.listAllAlbums(id, "title", validator),
      window.musex.listAllTracks(id, "title", validator),
    ])
      .then(([rawAlbums, tracks]) => {
        if (cancelled) return;
        const albums = albumsWithTrackGenres(rawAlbums, tracks);
        const genres = genreIndex(albums);
        const thumbsByGenre = new Map(
          genres.map(({ genre }) => [
            genre,
            sampleThumbs(
              albumsForGenre(genre, albums).map((a) => a.thumb),
              4,
              genre,
            ),
          ]),
        );
        setFetch({ status: "ok", genres, thumbsByGenre });
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

  const { genres, thumbsByGenre } = fetch;

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
            <CardCollage thumbs={thumbsByGenre.get(genre) ?? []} className="genre-card-collage" />
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
