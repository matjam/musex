import type { Album, LibrarySort } from "@musex/core";
import { useEffect, useState } from "react";
import { listValidator } from "../../../../shared/list-validator";
import { useApp } from "../../state/app";
import { AlbumArt } from "../AlbumArt";
import { SortSelector } from "../SortSelector";

type FetchState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ok"; albums: Album[] };

export function AlbumsView() {
  const { library, dispatch } = useApp();
  const [sort, setSort] = useState<LibrarySort>("title");
  const [fetch, setFetch] = useState<FetchState>({ status: "loading" });

  useEffect(() => {
    if (!library) return;
    const id = library.id;
    const validator = listValidator(library.updatedAt);
    let cancelled = false;
    setFetch({ status: "loading" });
    window.musex
      .listAllAlbums(id, sort, validator)
      .then((albums) => {
        if (!cancelled) setFetch({ status: "ok", albums });
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setFetch({
            status: "error",
            message: err instanceof Error ? err.message : "Failed to load albums",
          });
      });
    return () => {
      cancelled = true;
    };
  }, [library, sort]);

  if (fetch.status === "loading") {
    return <div className="content-placeholder">Loading albums…</div>;
  }

  if (fetch.status === "error") {
    return <div className="content-placeholder error-text">Error: {fetch.message}</div>;
  }

  const { albums } = fetch;

  if (albums.length === 0) {
    return <div className="content-placeholder">No albums found in this library.</div>;
  }

  return (
    <div className="browse-section">
      <div className="browse-header">
        <h3 className="browse-title">Albums</h3>
        <SortSelector value={sort} onChange={setSort} />
      </div>
      <div className="browse-sub">
        {albums.length} album{albums.length !== 1 ? "s" : ""}
      </div>
      <div className="browse-grid">
        {albums.map((album) => (
          <button
            type="button"
            key={album.id}
            className="grid-card"
            onClick={() => dispatch({ type: "navigate", view: { name: "album", album } })}
          >
            <AlbumArt thumb={album.thumb} className="grid-card-art" />
            <div className="grid-card-title">{album.title}</div>
            {album.year != null && <div className="grid-card-sub">{album.year}</div>}
          </button>
        ))}
      </div>
    </div>
  );
}
