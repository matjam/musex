import type { Album, Artist, Track } from "@musex/core";
import { ListEnd, ListPlus, MoreHorizontal, Play, Radio, Shuffle, Sparkles } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { listValidator } from "../../../../shared/list-validator";
import { useApp } from "../../state/app";
import { usePlayer } from "../../state/player";
import { useRatings } from "../../state/ratings";
import { AlbumArt } from "../AlbumArt";
import { StarRating } from "../StarRating";

type FetchState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ok"; albums: Album[] };

interface Props {
  artist: Artist;
}

export function ArtistDetailView({ artist }: Props) {
  const { library, dispatch } = useApp();
  const { playTracks, playTracksShuffled, enqueueNext, enqueueEnd, startRadioFromArtist } =
    usePlayer();
  const { ratingFor, rate, seed } = useRatings();
  const [fetch, setFetch] = useState<FetchState>({ status: "loading" });
  const [moreOpen, setMoreOpen] = useState(false);
  const [morePos, setMorePos] = useState({ x: 0, y: 0 });
  // "fetching" means we're loading tracks to queue; "idle" otherwise
  const [queueFetch, setQueueFetch] = useState<"idle" | "busy">("idle");

  // Artists navigated from track links lack userRating — fetch the authoritative
  // value and seed the overlay. seed() is set-only-if-absent, so a rating the
  // user clicked before this resolves is never clobbered.
  useEffect(() => {
    let cancelled = false;
    window.musex
      .getUserRating(artist.serverId, artist.id)
      .then((r) => {
        if (!cancelled) seed(artist.id, r);
      })
      .catch((err) => console.error("[ratings] getUserRating failed:", err));
    return () => {
      cancelled = true;
    };
  }, [artist.id, artist.serverId, seed]);

  useEffect(() => {
    if (!library) return;
    const id = library.id;
    setFetch({ status: "loading" });
    window.musex
      .listAlbums(id, artist.id, listValidator(artist.updatedAt))
      .then((albums) => setFetch({ status: "ok", albums }))
      .catch((err: unknown) =>
        setFetch({
          status: "error",
          message: err instanceof Error ? err.message : "Failed to load albums",
        }),
      );
  }, [library, artist.id, artist.updatedAt]);

  /** Fetch all tracks for the artist by flattening albums→tracks via existing IPC.
   *  Uses already-loaded albums to avoid any extra gateway method. */
  async function fetchAllTracks(): Promise<Track[]> {
    if (!library || fetch.status !== "ok") return [];
    const { id: libraryId } = library;
    const trackArrays = await Promise.all(
      fetch.albums.map((album) =>
        window.musex.listTracks(libraryId, album.id, listValidator(album.updatedAt)),
      ),
    );
    return trackArrays.flat();
  }

  function handleMoreClick(e: React.MouseEvent) {
    setMorePos({ x: e.clientX, y: e.clientY });
    setMoreOpen((o) => !o);
  }

  async function handlePlayAll() {
    setQueueFetch("busy");
    try {
      const tracks = await fetchAllTracks();
      if (tracks.length > 0) playTracks(tracks, 0);
    } finally {
      setQueueFetch("idle");
    }
  }

  async function handleShuffleAll() {
    setQueueFetch("busy");
    try {
      const tracks = await fetchAllTracks();
      if (tracks.length > 0) playTracksShuffled(tracks);
    } finally {
      setQueueFetch("idle");
    }
  }

  async function handlePlayNext() {
    setMoreOpen(false);
    setQueueFetch("busy");
    try {
      const tracks = await fetchAllTracks();
      if (tracks.length > 0) enqueueNext(tracks);
    } finally {
      setQueueFetch("idle");
    }
  }

  async function handleAddToQueue() {
    setMoreOpen(false);
    setQueueFetch("busy");
    try {
      const tracks = await fetchAllTracks();
      if (tracks.length > 0) enqueueEnd(tracks);
    } finally {
      setQueueFetch("idle");
    }
  }

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

      <div className="artist-header">
        <h3 className="browse-title">{artist.name}</h3>
        <StarRating
          value10={ratingFor(artist.id, artist.userRating)}
          onRate={(stars) =>
            rate({ serverId: artist.serverId, itemId: artist.id, stars, artistName: artist.name })
          }
          size={16}
          className="artist-stars"
        />
        <div className="album-actions">
          {fetch.status === "ok" && fetch.albums.length > 0 && (
            <>
              <button
                type="button"
                className="play-btn"
                title="Play all"
                disabled={queueFetch === "busy"}
                onClick={() => void handlePlayAll()}
              >
                <Play size={18} />
              </button>
              <button
                type="button"
                className="shuffle-btn"
                title="Shuffle all"
                disabled={queueFetch === "busy"}
                onClick={() => void handleShuffleAll()}
              >
                <Shuffle size={16} />
              </button>
              <button
                type="button"
                className="album-more-btn"
                title={queueFetch === "busy" ? "Loading…" : "More actions"}
                disabled={queueFetch === "busy"}
                onClick={handleMoreClick}
              >
                <MoreHorizontal size={18} />
              </button>
            </>
          )}
          <button
            type="button"
            className="shuffle-btn"
            title="Similar artists"
            onClick={() =>
              dispatch({
                type: "navigate",
                view: { name: "similar", target: { kind: "artist", name: artist.name } },
              })
            }
          >
            <Sparkles size={16} />
          </button>
        </div>
      </div>

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
                <AlbumArt
                  thumb={album.thumb}
                  className="grid-card-art"
                  label={album.title}
                  kind="album"
                />
                <div className="grid-card-title">{album.title}</div>
                <div className="grid-card-sub">{album.year != null ? String(album.year) : ""}</div>
              </button>
            ))}
          </div>
        </>
      )}

      {moreOpen && (
        <ArtistMoreMenu
          x={morePos.x}
          y={morePos.y}
          onClose={() => setMoreOpen(false)}
          onPlayNext={() => void handlePlayNext()}
          onAddToQueue={() => void handleAddToQueue()}
          onStartRadio={() => {
            startRadioFromArtist(artist.name);
            setMoreOpen(false);
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

interface MoreMenuProps {
  x: number;
  y: number;
  onClose: () => void;
  onPlayNext: () => void;
  onAddToQueue: () => void;
  onStartRadio: () => void;
}

/** Fixed-position dropdown for "Play next" / "Add to queue" / "Start Artist
 *  Radio" on the artist. */
function ArtistMoreMenu({ x, y, onClose, onPlayNext, onAddToQueue, onStartRadio }: MoreMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const MARGIN = 8;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = x;
    let top = y;
    if (left + rect.width > vw - MARGIN) left = vw - rect.width - MARGIN;
    if (top + rect.height > vh - MARGIN) top = vh - rect.height - MARGIN;
    left = Math.max(MARGIN, left);
    top = Math.max(MARGIN, top);
    setPos({ left, top });
  }, [x, y]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="more-dropdown"
      role="menu"
      style={{ left: pos.left, top: pos.top }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <button type="button" className="ctx-item ctx-item--icon" onClick={onPlayNext}>
        <ListPlus size={14} />
        Play next
      </button>
      <button type="button" className="ctx-item ctx-item--icon" onClick={onAddToQueue}>
        <ListEnd size={14} />
        Add to queue
      </button>
      <button type="button" className="ctx-item ctx-item--icon" onClick={onStartRadio}>
        <Radio size={14} />
        Start Artist Radio
      </button>
    </div>
  );
}
