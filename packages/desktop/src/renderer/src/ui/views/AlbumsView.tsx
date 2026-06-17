import type { Album, LibrarySort } from "@musex/core";
import { listValidator } from "@musex/core";
import { ListChecks } from "lucide-react";
import { useEffect, useState } from "react";
import { useApp } from "../../state/app";
import { acquisitionStateFor } from "../../util/acquisition-map";
import { GridCard } from "../GridCard";
import { useAcquisitionMap } from "../hooks/useAcquisitionMap";
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
  // Acquisition status is album-granular, so albums match by title. Degrades to
  // an empty map offline / on error (see useAcquisitionMap).
  const acquiring = useAcquisitionMap("title");
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
  // "downloaded" shows only cards with a downloaded track; "acquiring" shows
  // only albums currently being acquired (by title), plus a link to the full
  // acquisition activity feed.
  const visible =
    filter === "downloaded"
      ? albums.filter((a) => downloaded.has(a.id))
      : filter === "acquiring"
        ? albums.filter((a) => acquiring.has(a.title.trim().toLowerCase()))
        : albums;

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
        <>
          <button
            type="button"
            className="acquiring-activity-link"
            onClick={() => dispatch({ type: "navigate", view: { name: "acquiring" } })}
          >
            <ListChecks size={14} />
            View acquisition activity
          </button>
          {visible.length === 0 ? (
            <div className="content-placeholder">No albums are being acquired right now.</div>
          ) : (
            <>
              <div className="browse-sub">
                {visible.length} album{visible.length !== 1 ? "s" : ""} acquiring
              </div>
              <div className="browse-grid">
                {visible.map((album) => (
                  <GridCard
                    key={album.id}
                    thumb={album.thumb}
                    title={album.title}
                    subtitle={album.year != null ? String(album.year) : undefined}
                    state={
                      downloaded.has(album.id)
                        ? "downloaded"
                        : acquisitionStateFor(acquiring, album.title)
                    }
                    onOpen={() => dispatch({ type: "navigate", view: { name: "album", album } })}
                    onPlay={() => void playAlbum(album)}
                  />
                ))}
              </div>
            </>
          )}
        </>
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
                // Downloaded wins over an in-flight acquisition badge — an album
                // already on disk shouldn't read as "Requested".
                state={
                  downloaded.has(album.id)
                    ? "downloaded"
                    : acquisitionStateFor(acquiring, album.title)
                }
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
