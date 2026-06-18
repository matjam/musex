import type { Artist } from "@musex/core";
import { entityRefForArtist, listValidator } from "@musex/core";
import { ListChecks } from "lucide-react";
import { useEffect, useState } from "react";
import { useApp } from "../../state/app";
import { useFollow } from "../../state/follow";
import type { AcquisitionBadgeState } from "../discovery/state-badge";
import { GridCard } from "../GridCard";
import { useCollectionPlay } from "../hooks/useCollectionPlay";
import { useDownloadedSet, useDownloadingSet } from "../hooks/useDownloadedSet";
import { LibraryFilter, type LibraryFilterMode } from "../LibraryFilter";

type FetchState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ok"; artists: Artist[] };

export function ArtistsView() {
  const { library, connectivity, dispatch } = useApp();
  const { playArtist } = useCollectionPlay();
  const { isFollowed } = useFollow();
  const [filter, setFilter] = useState<LibraryFilterMode>("all");
  // An artist is "followed" (was: watched for new releases) when followed via
  // the FollowProvider. Cards mark followed artists; the filter narrows to them.
  const followedArtist = (a: Artist) => isFollowed(entityRefForArtist(a));
  const [fetch, setFetch] = useState<FetchState>({ status: "loading" });
  // Artist cards reflect LOCAL download state only: a downloaded artist (≥1
  // track on disk for the artistId) → "downloaded"; else an in-flight (queued/
  // downloading) artist → "downloading"; else no badge. Cached content is
  // track-level (keyed by plexPath) and can't be cheaply attributed to a
  // container card, so it's deliberately not reflected here — track lists get
  // exact availability. The Lidarr acquisition queue is NOT overlaid on cards.
  const downloaded = useDownloadedSet("artistId");
  const downloading = useDownloadingSet("artistId");
  const offline = connectivity === "offline";

  // Local download state → card badge. Downloaded wins over in-flight.
  function cardState(artistId: string): AcquisitionBadgeState | undefined {
    if (downloaded.has(artistId)) return "downloaded";
    if (downloading.has(artistId)) return "downloading";
    return undefined;
  }

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
  // "downloaded" shows only artists with a downloaded track; "watching" shows
  // only artists watched for new releases, plus a link to the full acquisition
  // activity feed.
  const visible =
    filter === "downloaded"
      ? artists.filter((a) => downloaded.has(a.id))
      : filter === "watching"
        ? artists.filter(followedArtist)
        : artists;

  return (
    <div className="browse-section">
      <div className="browse-header">
        <h3 className="browse-title">Artists</h3>
        <div className="browse-controls">
          <LibraryFilter
            value={filter}
            onChange={setFilter}
            modes={["all", "downloaded", "watching"]}
          />
        </div>
      </div>
      {filter === "watching" ? (
        <>
          <button
            type="button"
            className="acquiring-activity-link"
            onClick={() => dispatch({ type: "navigate", view: { name: "activity" } })}
          >
            <ListChecks size={14} />
            View acquisition activity
          </button>
          {visible.length === 0 ? (
            <div className="content-placeholder">
              No artists are being watched for new releases.
            </div>
          ) : (
            <>
              <div className="browse-sub">
                {visible.length} artist{visible.length !== 1 ? "s" : ""} watched
              </div>
              <div className="browse-grid">
                {visible.map((artist) => (
                  <GridCard
                    key={artist.id}
                    thumb={artist.thumb}
                    title={artist.name}
                    round
                    state={cardState(artist.id)}
                    monitored={followedArtist(artist)}
                    onOpen={() =>
                      dispatch({
                        type: "navigate",
                        view: { name: "artist", ref: entityRefForArtist(artist) },
                      })
                    }
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
                state={cardState(artist.id)}
                monitored={followedArtist(artist)}
                dim={offline && !downloaded.has(artist.id)}
                onOpen={() =>
                  dispatch({
                    type: "navigate",
                    view: { name: "artist", ref: entityRefForArtist(artist) },
                  })
                }
                onPlay={() => void playArtist(artist)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
