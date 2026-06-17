import type { Artist } from "@musex/core";
import { listValidator } from "@musex/core";
import { useEffect, useState } from "react";
import { useApp } from "../../state/app";
import { GridCard } from "../GridCard";
import { useCollectionPlay } from "../hooks/useCollectionPlay";
import { useDownloadedSet } from "../hooks/useDownloadedSet";
import { LibraryFilter, type LibraryFilterMode } from "../LibraryFilter";

type FetchState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ok"; artists: Artist[] };

export function ArtistsView() {
  const { library, connectivity, dispatch } = useApp();
  const { playArtist } = useCollectionPlay();
  const [filter, setFilter] = useState<LibraryFilterMode>("all");
  const [fetch, setFetch] = useState<FetchState>({ status: "loading" });
  // Artist cards reflect DOWNLOADED-presence only (≥1 track on disk for the
  // artistId). Cached content is track-level (keyed by plexPath) and can't be
  // cheaply attributed to a container card without fetching its tracks, so it's
  // deliberately not reflected here — track lists get exact availability.
  const downloaded = useDownloadedSet("artistId");
  const offline = connectivity === "offline";

  useEffect(() => {
    if (!library) return;
    const id = library.id;
    const validator = listValidator(library.updatedAt);
    let cancelled = false;
    setFetch({ status: "loading" });
    window.musex
      .listArtists(id, validator)
      .then((artists) => {
        if (!cancelled) setFetch({ status: "ok", artists });
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setFetch({
            status: "error",
            message: err instanceof Error ? err.message : "Failed to load artists",
          });
      });
    return () => {
      cancelled = true;
    };
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

  // "all" shows everything (offline: un-downloaded cards dimmed, not hidden);
  // "downloaded" shows only artists with a downloaded track; "acquiring" is a
  // Phase 5 feature — for now it's an explicit empty state.
  const visible = filter === "downloaded" ? artists.filter((a) => downloaded.has(a.id)) : artists;

  return (
    <div className="browse-section">
      <div className="browse-header">
        <h3 className="browse-title">Artists</h3>
        <div className="browse-controls">
          <LibraryFilter value={filter} onChange={setFilter} />
        </div>
      </div>
      {filter === "acquiring" ? (
        <div className="content-placeholder">Items you're acquiring will appear here.</div>
      ) : filter === "downloaded" && visible.length === 0 ? (
        <div className="content-placeholder">No downloaded artists yet.</div>
      ) : (
        <>
          <div className="browse-sub">
            {visible.length} artist{visible.length !== 1 ? "s" : ""}
          </div>
          <div className="browse-grid">
            {visible.map((artist) => (
              <GridCard
                key={artist.id}
                thumb={artist.thumb}
                title={artist.name}
                round
                state={downloaded.has(artist.id) ? "downloaded" : undefined}
                dim={offline && !downloaded.has(artist.id)}
                onOpen={() => dispatch({ type: "navigate", view: { name: "artist", artist } })}
                onPlay={() => void playArtist(artist)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
