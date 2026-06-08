import type { Album, Artist } from "@musex/core";
import { useEffect, useState } from "react";
import { useApp } from "../../state/app";
import { AlbumArt } from "../AlbumArt";

type FetchState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ok"; albums: Album[] };

interface Props {
  artist: Artist;
}

export function ArtistDetailView({ artist }: Props) {
  const { library, dispatch } = useApp();
  const [fetch, setFetch] = useState<FetchState>({ status: "loading" });

  useEffect(() => {
    if (!library) return;
    const id = library.id;
    setFetch({ status: "loading" });
    window.musex
      .listAlbums(id, artist.id)
      .then((albums) => setFetch({ status: "ok", albums }))
      .catch((err: unknown) =>
        setFetch({
          status: "error",
          message: err instanceof Error ? err.message : "Failed to load albums",
        }),
      );
  }, [library, artist.id]);

  return (
    <div className="browse-section">
      <div className="breadcrumb">
        <button
          type="button"
          className="breadcrumb-link"
          onClick={() => dispatch({ type: "navigate", view: { name: "artists" } })}
        >
          Artists
        </button>
        {" › "}
        <span className="breadcrumb-current">{artist.name}</span>
      </div>

      <h3 className="browse-title">{artist.name}</h3>

      {fetch.status === "loading" && <div className="content-placeholder">Loading albums…</div>}

      {fetch.status === "error" && (
        <div className="content-placeholder error-text">Error: {fetch.message}</div>
      )}

      {fetch.status === "ok" && fetch.albums.length === 0 && (
        <div className="content-placeholder">No albums found for this artist.</div>
      )}

      {fetch.status === "ok" && fetch.albums.length > 0 && (
        <>
          <div className="browse-sub">
            {fetch.albums.length} album{fetch.albums.length !== 1 ? "s" : ""}
          </div>
          <div className="browse-grid">
            {fetch.albums.map((album) => (
              <button
                type="button"
                key={album.id}
                className="grid-card"
                onClick={() => dispatch({ type: "navigate", view: { name: "album", album } })}
              >
                <AlbumArt thumb={album.thumb} className="grid-card-art" />
                <div className="grid-card-title">{album.title}</div>
                <div className="grid-card-sub">{album.year != null ? String(album.year) : ""}</div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
