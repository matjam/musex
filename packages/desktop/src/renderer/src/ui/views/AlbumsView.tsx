import type { Album, LibrarySort } from "@musex/core";
import { listValidator } from "@musex/core";
import { useEffect, useState } from "react";
import { useApp } from "../../state/app";
import { GridCard } from "../GridCard";
import { useCollectionPlay } from "../hooks/useCollectionPlay";
import { useDownloadedSet } from "../hooks/useDownloadedSet";
import { LibraryFilter, type LibraryFilterMode } from "../LibraryFilter";
import { SortSelector } from "../SortSelector";

type FetchState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ok"; albums: Album[] };

export function AlbumsView() {
  const { library, connectivity, dispatch } = useApp();
  const { playAlbum } = useCollectionPlay();
  const [sort, setSort] = useState<LibrarySort>("title");
  const [filter, setFilter] = useState<LibraryFilterMode>("all");
  const [fetch, setFetch] = useState<FetchState>({ status: "loading" });
  // Album cards reflect DOWNLOADED-presence only (≥1 track on disk for the
  // albumId). Cached content is track-level (keyed by plexPath) and can't be
  // cheaply attributed to a container card without fetching its track list, so
  // it's deliberately not reflected here — track lists below get exact
  // downloaded∪cached availability.
  const downloaded = useDownloadedSet("albumId");
  const offline = connectivity === "offline";

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

  // "all" shows everything (offline: un-downloaded cards are dimmed, not hidden);
  // "downloaded" shows only cards with a downloaded track; "acquiring" is a
  // Phase 5 feature — for now it's an explicit empty state.
  const visible = filter === "downloaded" ? albums.filter((a) => downloaded.has(a.id)) : albums;

  return (
    <div className="browse-section">
      <div className="browse-header">
        <h3 className="browse-title">Albums</h3>
        <div className="browse-controls">
          <LibraryFilter value={filter} onChange={setFilter} />
          <SortSelector value={sort} onChange={setSort} />
        </div>
      </div>
      {filter === "acquiring" ? (
        <div className="content-placeholder">Items you're acquiring will appear here.</div>
      ) : filter === "downloaded" && visible.length === 0 ? (
        <div className="content-placeholder">No downloaded albums yet.</div>
      ) : (
        <>
          <div className="browse-sub">
            {visible.length} album{visible.length !== 1 ? "s" : ""}
          </div>
          <div className="browse-grid">
            {visible.map((album) => (
              <GridCard
                key={album.id}
                thumb={album.thumb}
                title={album.title}
                subtitle={album.year != null ? String(album.year) : undefined}
                state={downloaded.has(album.id) ? "downloaded" : undefined}
                dim={offline && !downloaded.has(album.id)}
                onOpen={() => dispatch({ type: "navigate", view: { name: "album", album } })}
                onPlay={() => void playAlbum(album)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
