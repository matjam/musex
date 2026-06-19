import type { Album, Artist, EntityRef, Track } from "@musex/core";
import { entityRefForArtist, listValidator } from "@musex/core";
import { Download, ListEnd, ListPlus, MoreHorizontal, Radio } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { AcquirableAlbumDto, ArtistInfoDto } from "../../../../shared/ipc-contract";
import { useApp } from "../../state/app";
import { useFollow } from "../../state/follow";
import { usePlayer } from "../../state/player";
import { useRatings } from "../../state/ratings";
import { OFFLINE_ACTION_TOOLTIP, OFFLINE_VIEW_MESSAGE } from "../../util/offline";
import { ActionBar } from "../discovery/ActionBar";
import { useFollowAction } from "../discovery/FollowButton";
import { MonitorStatusLine } from "../discovery/MonitorStatusLine";
import { GridCard } from "../GridCard";
import { useAcquisitionAvailable } from "../hooks/useAcquisitionAvailable";
import { useEntityNav } from "../hooks/useEntityNav";
import { StarRating } from "../StarRating";
import { type DiscographyItem, unifyDiscography } from "./artist-discography";

/** Owned Plex albums (always exact, never online-gated) loaded for an owned
 *  artist. External rows are the acquisition discography (online + provider). */
type OwnedState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ok" };

interface Props {
  /** The artist to render — owned (Plex) or external (last.fm-only). Ownership
   *  is read from `ref.source` plus what the discography cross-check reports. */
  ref: EntityRef;
}

/** The one artist page: owned + unowned + acquisition inline. Reached
 *  identically from everywhere via `resolveEntity`. Owned artists fetch their
 *  Plex albums and (when an acquisition provider is online) union the rest of
 *  the discography with status badges; external artists fetch the acquisition
 *  discography alone. Follow (= acquire + watch) is the headline action. */
export function ArtistView({ ref }: Props) {
  const owned = ref.source === "plex";
  const artist: Artist = {
    id: ref.id ?? "",
    serverId: ref.serverId ?? "",
    name: ref.name,
    thumb: ref.thumb,
  };
  const { library, dispatch, connectivity } = useApp();
  const offline = connectivity === "offline";
  const acquisitionAvailable = useAcquisitionAvailable();
  const { playTracks, playTracksShuffled, enqueueNext, enqueueEnd, startRadioFromArtist } =
    usePlayer();
  const { ratingFor, rate, seed } = useRatings();
  const { goRef } = useEntityNav();
  // Follow toggles the acquire+watch relationship for this artist (one action).
  const follow = useFollowAction(ref);
  const { isFollowed } = useFollow();

  // Owned albums (exact, offline-safe) + external discography (online, provider)
  // are loaded separately and merged into one mixed list.
  const [ownedAlbums, setOwnedAlbums] = useState<Album[]>([]);
  const [ownedState, setOwnedState] = useState<OwnedState>({ status: "idle" });
  const [external, setExternal] = useState<AcquirableAlbumDto[]>([]);
  const [externalState, setExternalState] = useState<"idle" | "loading" | "error" | "ok">("idle");
  const [info, setInfo] = useState<ArtistInfoDto | null>(null);

  const [moreOpen, setMoreOpen] = useState(false);
  const [morePos, setMorePos] = useState({ x: 0, y: 0 });
  const [queueFetch, setQueueFetch] = useState<"idle" | "busy">("idle");

  // Owned artists may arrive (e.g. from a track link) without userRating — fetch
  // the authoritative value and seed the overlay (set-only-if-absent).
  useEffect(() => {
    if (!owned) return;
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
  }, [owned, artist.id, artist.serverId, seed]);

  // Owned albums via the library (no online dependency).
  useEffect(() => {
    if (!owned || !library) {
      setOwnedState({ status: "idle" });
      setOwnedAlbums([]);
      return;
    }
    const id = library.id;
    setOwnedState({ status: "loading" });
    let cancelled = false;
    window.musex
      .listAlbums(id, artist.id, listValidator(artist.updatedAt))
      .then((albums) => {
        if (cancelled) return;
        setOwnedAlbums(albums);
        setOwnedState({ status: "ok" });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setOwnedState({
          status: "error",
          message: err instanceof Error ? err.message : "Failed to load albums",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [owned, library, artist.id, artist.updatedAt]);

  // External discography (acquisition ∪ last.fm). Online + a provider only.
  // For an external artist this is the whole discography; for an owned one it
  // fills in the not-in-library albums with status badges.
  useEffect(() => {
    if (offline || (owned && !acquisitionAvailable)) {
      setExternal([]);
      setExternalState("idle");
      return;
    }
    // An external artist with no provider has no data to show at all.
    if (!owned && !acquisitionAvailable) {
      setExternal([]);
      setExternalState("ok");
      return;
    }
    setExternalState("loading");
    let cancelled = false;
    window.musex
      .acquisitionDiscography(ref.name)
      .then((albums) => {
        if (cancelled) return;
        setExternal(albums);
        setExternalState("ok");
      })
      .catch((err: unknown) => {
        console.error("[acquisition] acquisitionDiscography failed:", err);
        if (cancelled) return;
        setExternal([]);
        setExternalState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [owned, ref.name, offline, acquisitionAvailable]);

  // last.fm bio/stats (About). Online-only; best-effort (hidden on failure).
  useEffect(() => {
    if (offline) {
      setInfo(null);
      return;
    }
    let cancelled = false;
    window.musex
      .artistInfoGet(ref.name)
      .then((i) => {
        if (!cancelled) setInfo(i);
      })
      .catch((err: unknown) => console.error("[artistInfo] get failed:", err));
    return () => {
      cancelled = true;
    };
  }, [ref.name, offline]);

  const discography: DiscographyItem[] = unifyDiscography(ownedAlbums, external);

  // Owned albums are the only source we can flatten into tracks for the
  // header Play/Shuffle/queue actions (external titles aren't playable).
  async function fetchAllTracks(): Promise<Track[]> {
    if (!library || ownedAlbums.length === 0) return [];
    const { id: libraryId } = library;
    const trackArrays = await Promise.all(
      ownedAlbums.map((album) =>
        window.musex.listTracks(libraryId, album.id, listValidator(album.updatedAt)),
      ),
    );
    return trackArrays.flat();
  }

  function runWithTracks(fn: (tracks: Track[]) => void) {
    setQueueFetch("busy");
    void fetchAllTracks()
      .then((tracks) => {
        if (tracks.length > 0) fn(tracks);
      })
      .finally(() => setQueueFetch("idle"));
  }

  function handleDownloadAll() {
    setMoreOpen(false);
    if (!library) return;
    window.musex
      .downloadArtist(artist.id, library.id)
      .catch((err: unknown) => console.error("[downloads] downloadArtist failed:", err));
  }

  // Optimistic per-album acquire for the quiet "Get just this album" path on an
  // external row. The plugin toasts success/failure; we only flip the local
  // status so the badge reads Acquiring (revert on the IPC rejecting).
  function acquireAlbum(item: DiscographyItem) {
    const a = item.acquire;
    if (!a) return;
    setExternal((prev) =>
      prev.map((x) =>
        x.providerId === a.providerId && x.providerRef === a.providerRef
          ? { ...x, state: "requested" as const }
          : x,
      ),
    );
    window.musex.acquisitionAcquire(a).catch((err: unknown) => {
      console.error("[acquisition] acquire failed:", err);
      setExternal((prev) =>
        prev.map((x) =>
          x.providerId === a.providerId && x.providerRef === a.providerRef
            ? { ...x, state: "available" as const }
            : x,
        ),
      );
    });
  }

  const hasOwnedAlbums = ownedAlbums.length > 0;
  const discogLoading =
    (owned && ownedState.status === "loading") ||
    (externalState === "loading" && discography.length === 0);
  const ownedError = owned && ownedState.status === "error" ? ownedState.message : null;

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
        {owned && (
          <StarRating
            value10={ratingFor(artist.id, artist.userRating)}
            onRate={(stars) =>
              rate({ serverId: artist.serverId, itemId: artist.id, stars, artistName: artist.name })
            }
            size={16}
            className="artist-stars"
          />
        )}
        <ActionBar
          onPlay={
            owned && hasOwnedAlbums ? () => runWithTracks((t) => playTracks(t, 0)) : undefined
          }
          onShuffle={
            owned && hasOwnedAlbums ? () => runWithTracks((t) => playTracksShuffled(t)) : undefined
          }
          onSimilar={() =>
            dispatch({
              type: "navigate",
              view: { name: "similar", target: { kind: "artist", name: artist.name } },
            })
          }
          follow={{
            on: follow.on,
            busy: follow.busy,
            disabled: offline,
            title: offline ? OFFLINE_ACTION_TOOLTIP : undefined,
            onToggle: () => void follow.onToggle(),
          }}
          overflow={
            owned && hasOwnedAlbums ? (
              <button
                type="button"
                className="action-icon"
                title={queueFetch === "busy" ? "Loading…" : "More actions"}
                disabled={queueFetch === "busy"}
                onClick={(e) => {
                  setMorePos({ x: e.clientX, y: e.clientY });
                  setMoreOpen((o) => !o);
                }}
              >
                <MoreHorizontal size={18} />
              </button>
            ) : undefined
          }
        />
        {/* TODO: real download count (Phase F) */}
        <MonitorStatusLine watching={isFollowed(ref)} downloading={0} />
      </div>

      {/* The whole external discography lookup is online-only; an external
          artist with no owned albums has nothing to show offline. */}
      {offline && !owned && <div className="content-placeholder">{OFFLINE_VIEW_MESSAGE}</div>}

      {ownedError && <div className="content-placeholder error-text">Error: {ownedError}</div>}

      {discogLoading && <div className="content-placeholder">Loading discography…</div>}

      {!discogLoading && discography.length === 0 && !ownedError && !(offline && !owned) && (
        <div className="content-placeholder">
          {owned ? "No albums found for this artist." : "No acquisition source knows this artist."}
        </div>
      )}

      {discography.length > 0 && (
        <>
          <div className="browse-sub">
            {discography.length} album{discography.length !== 1 ? "s" : ""}
          </div>
          <div className="browse-grid">
            {discography.map((item) => (
              <GridCard
                key={item.key}
                thumb={item.thumb}
                title={item.title}
                subtitle={item.year != null ? String(item.year) : undefined}
                entity={item.ref}
                downloaded={item.downloaded}
                acquiring={item.acquiring}
                dim={item.unavailable}
                onOpen={() => goRef(item.ref)}
                onGetAlbum={item.acquire ? () => acquireAlbum(item) : undefined}
              />
            ))}
          </div>
        </>
      )}

      {info?.bio && (
        <section className="home-row artist-about">
          <h3 className="browse-title">About</h3>
          <p className="artist-bio">{info.bio}</p>
        </section>
      )}

      {moreOpen && (
        <ArtistMoreMenu
          x={morePos.x}
          y={morePos.y}
          offline={offline}
          onClose={() => setMoreOpen(false)}
          onPlayNext={() => {
            setMoreOpen(false);
            runWithTracks((t) => enqueueNext(t));
          }}
          onAddToQueue={() => {
            setMoreOpen(false);
            runWithTracks((t) => enqueueEnd(t));
          }}
          onStartRadio={() => {
            startRadioFromArtist(artist.name);
            setMoreOpen(false);
          }}
          onDownloadAll={handleDownloadAll}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

interface MoreMenuProps {
  x: number;
  y: number;
  offline: boolean;
  onClose: () => void;
  onPlayNext: () => void;
  onAddToQueue: () => void;
  onStartRadio: () => void;
  onDownloadAll: () => void;
}

/** Fixed-position dropdown for "Play next" / "Add to queue" / "Start Artist
 *  Radio" / "Download all albums" on the artist. */
function ArtistMoreMenu({
  x,
  y,
  offline,
  onClose,
  onPlayNext,
  onAddToQueue,
  onStartRadio,
  onDownloadAll,
}: MoreMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const MARGIN = 8;

  useLayoutEffect(() => {
    const el = menuRef.current;
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
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
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
      ref={menuRef}
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
      <div className="ctx-sep" />
      <button
        type="button"
        className="ctx-item ctx-item--icon"
        disabled={offline}
        title={offline ? OFFLINE_ACTION_TOOLTIP : undefined}
        onClick={onDownloadAll}
      >
        <Download size={14} />
        Download all albums
      </button>
    </div>
  );
}
