import type { Artist } from "@musex/core";
import { useEffect, useState } from "react";
import { useApp } from "../../state/app";
import { AlbumArt } from "../AlbumArt";

type FetchState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ok"; artists: Artist[] };

export function ArtistsView() {
  const { library, dispatch } = useApp();
  const [fetch, setFetch] = useState<FetchState>({ status: "loading" });

  useEffect(() => {
    if (!library) return;
    const id = library.id;
    setFetch({ status: "loading" });
    window.musex
      .listArtists(id)
      .then((artists) => setFetch({ status: "ok", artists }))
      .catch((err: unknown) =>
        setFetch({
          status: "error",
          message: err instanceof Error ? err.message : "Failed to load artists",
        }),
      );
  }, [library]);

  if (fetch.status === "loading") {
    return <div className="content-placeholder">Loading artists…</div>;
  }

  if (fetch.status === "error") {
    return <div className="content-placeholder error-text">Error: {fetch.message}</div>;
  }

  const { artists } = fetch;

  if (artists.length === 0) {
    return <div className="content-placeholder">No artists found in this library.</div>;
  }

  return (
    <div className="browse-section">
      <h3 className="browse-title">Artists</h3>
      <div className="browse-sub">
        {artists.length} artist{artists.length !== 1 ? "s" : ""}
      </div>
      <div className="browse-grid">
        {artists.map((artist) => (
          <button
            type="button"
            key={artist.id}
            className="grid-card"
            onClick={() => dispatch({ type: "navigate", view: { name: "artist", artist } })}
          >
            <AlbumArt thumb={artist.thumb} className="grid-card-art artist-art" />
            <div className="grid-card-title">{artist.name}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
