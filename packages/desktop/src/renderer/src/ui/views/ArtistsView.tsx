import type { Artist } from "@musex/core";
import { listValidator } from "@musex/core";
import { ListChecks } from "lucide-react";
import { useEffect, useState } from "react";
import { useApp } from "../../state/app";
import { acquisitionKey, acquisitionStateFor } from "../../util/acquisition-map";
import { GridCard } from "../GridCard";
import { useAcquisitionMap } from "../hooks/useAcquisitionMap";
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
  // Acquisition status rows are album-level; roll them up to the artist (any
  // acquiring album → the artist tile shows the furthest-along state). Degrades
  // to an empty map offline / on error (see useAcquisitionMap).
  const acquiring = useAcquisitionMap("artistName");
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
  // "downloaded" shows only artists with a downloaded track; "acquiring" shows
  // only artists with an album currently being acquired (by name), plus a link
  // to the full acquisition activity feed.
  const visible =
    filter === "downloaded"
      ? artists.filter((a) => downloaded.has(a.id))
      : filter === "acquiring"
        ? artists.filter((a) => acquiring.has(acquisitionKey(a.name)))
        : artists;

  return (
    <div className="browse-section">
      <div className="browse-header">
        <h3 className="browse-title">Artists</h3>
        <div className="browse-controls">
          <LibraryFilter value={filter} onChange={setFilter} />
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
            <div className="content-placeholder">No artists are being acquired right now.</div>
          ) : (
            <>
              <div className="browse-sub">
                {visible.length} artist{visible.length !== 1 ? "s" : ""} acquiring
              </div>
              <div className="browse-grid">
                {visible.map((artist) => (
                  <GridCard
                    key={artist.id}
                    thumb={artist.thumb}
                    title={artist.name}
                    round
                    state={
                      downloaded.has(artist.id)
                        ? "downloaded"
                        : acquisitionStateFor(acquiring, artist.name)
                    }
                    onOpen={() => dispatch({ type: "navigate", view: { name: "artist", artist } })}
                    onPlay={() => void playArtist(artist)}
                  />
                ))}
              </div>
            </>
          )}
        </>
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
                // Downloaded wins over an in-flight acquisition badge — an artist
                // already (partly) on disk shouldn't read as "Requested".
                state={
                  downloaded.has(artist.id)
                    ? "downloaded"
                    : acquisitionStateFor(acquiring, artist.name)
                }
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
