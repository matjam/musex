import type { Playlist, Track } from "@musex/core";
import {
  ChevronRight,
  Disc3,
  Download,
  ExternalLink,
  Heart,
  ListEnd,
  ListPlus,
  type LucideIcon,
  Mic2,
  Puzzle,
  Radio,
  Sparkles,
  Star,
  Trash2,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { DownloadDto, TrackActionDto } from "../../../shared/ipc-contract";
import { useApp } from "../state/app";
import { toTrackInfo, usePlayer } from "../state/player";
import { usePlaylists } from "../state/playlists";
import { OFFLINE_ACTION_TOOLTIP } from "../util/offline";
import { useEntityNav } from "./hooks/useEntityNav";

const VIEWPORT_MARGIN = 8;
const SUBMENU_WIDTH = 200;

/** Plugins name lucide icons as strings; only this allowlist is resolved —
 *  arbitrary names fall back to the generic plugin icon. */
const ACTION_ICONS: Record<string, LucideIcon> = {
  heart: Heart,
  star: Star,
  "external-link": ExternalLink,
};

export interface TrackMenuTarget {
  x: number;
  y: number;
  trackId: string;
  serverId: string;
  /** The full Track object — required for queue actions. */
  track: Track;
  /** Provided only when the row is inside a playlist (enables Remove). */
  playlistContext?: { playlistId: string; playlistItemId: string };
}

interface Props {
  target: TrackMenuTarget;
  onClose: () => void;
  onNewPlaylist: (trackId: string) => void; // opens the NewPlaylistDialog seeded with this track
  /** Called after a successful remove-from-playlist so the parent can re-fetch. */
  onChanged?: () => void;
  /** The downloaded record for this track (looked up by serverId+partKey), or
   *  undefined when not downloaded. Drives the Download vs Remove item. Omit to
   *  hide the download/remove items entirely. */
  downloadRecord?: DownloadDto;
  /** Library id required to start a download. Omit/null to hide the Download
   *  item (the "Remove download" item never needs it). */
  libraryId?: string | null;
}

export function TrackContextMenu({
  target,
  onClose,
  onNewPlaylist,
  onChanged,
  downloadRecord,
  libraryId,
}: Props) {
  const { playlists, addTo, remove } = usePlaylists();
  const { dispatch, connectivity } = useApp();
  const offline = connectivity === "offline";
  const { enqueueNext, enqueueEnd, startRadioFromTrack } = usePlayer();
  const { goArtist, goAlbum } = useEntityNav();
  const [submenu, setSubmenu] = useState(false);
  const [pluginActions, setPluginActions] = useState<TrackActionDto[]>([]);
  const ref = useRef<HTMLDivElement>(null);
  // Start at the click point; clamp into the viewport before paint (below).
  const [pos, setPos] = useState({ left: target.x, top: target.y });
  // Open the submenu leftward when there isn't room for it on the right.
  const [submenuLeft, setSubmenuLeft] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = target.x;
    let top = target.y;
    if (left + rect.width > vw - VIEWPORT_MARGIN) left = vw - rect.width - VIEWPORT_MARGIN;
    if (top + rect.height > vh - VIEWPORT_MARGIN) top = vh - rect.height - VIEWPORT_MARGIN;
    left = Math.max(VIEWPORT_MARGIN, left);
    top = Math.max(VIEWPORT_MARGIN, top);
    setPos({ left, top });
    setSubmenuLeft(left + rect.width + SUBMENU_WIDTH > vw - VIEWPORT_MARGIN);
  }, [target.x, target.y]);

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

  // Plugin-contributed actions, fetched once per menu open (mount = open).
  useEffect(() => {
    let cancelled = false;
    window.musex
      .trackActionsList()
      .then((actions) => {
        if (!cancelled) setPluginActions(actions);
      })
      .catch((err) => console.error("[plugins] trackActionsList failed:", err));
    return () => {
      cancelled = true;
    };
  }, []);

  async function invokePluginAction(action: TrackActionDto) {
    try {
      await window.musex.trackActionsInvoke(action.id, toTrackInfo(target.track));
    } catch (err) {
      // Plugins surface their own toasts via ctx.ui.notify; just log here.
      console.error("[plugins] track action failed:", err);
    }
  }

  async function add(p: Playlist) {
    await addTo(p.id, p.serverId, [target.trackId]);
    onClose();
  }
  async function removeHere() {
    if (!target.playlistContext) return;
    await remove(target.playlistContext.playlistId, target.serverId, [
      target.playlistContext.playlistItemId,
    ]);
    onChanged?.();
    onClose();
  }

  async function downloadTrack() {
    if (!libraryId) return;
    try {
      await window.musex.downloadTracks([target.track], libraryId);
    } catch (err) {
      console.error("[downloads] downloadTracks failed:", err);
    }
    onClose();
  }
  async function removeTrackDownload() {
    if (!downloadRecord) return;
    try {
      await window.musex.removeDownload(downloadRecord.key);
    } catch (err) {
      console.error("[downloads] removeDownload failed:", err);
    }
    onClose();
  }

  return (
    <div
      ref={ref}
      className="ctx-menu"
      role="menu"
      style={{ left: pos.left, top: pos.top }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <button
        type="button"
        className="ctx-item ctx-item--icon"
        onClick={() => {
          enqueueNext([target.track]);
          onClose();
        }}
      >
        <ListPlus size={14} />
        Play next
      </button>
      <button
        type="button"
        className="ctx-item ctx-item--icon"
        onClick={() => {
          enqueueEnd([target.track]);
          onClose();
        }}
      >
        <ListEnd size={14} />
        Add to queue
      </button>
      <div className="ctx-sep" />
      <button
        type="button"
        className="ctx-item ctx-item--icon"
        disabled={!target.track.artistId}
        onClick={() => {
          goArtist(target.track);
          onClose();
        }}
      >
        <Mic2 size={14} />
        Go to artist
      </button>
      <button
        type="button"
        className="ctx-item ctx-item--icon"
        disabled={!target.track.albumId}
        onClick={() => {
          goAlbum(target.track);
          onClose();
        }}
      >
        <Disc3 size={14} />
        Go to album
      </button>
      <div className="ctx-sep" />
      <button
        type="button"
        className="ctx-item ctx-item--icon"
        onClick={() => {
          startRadioFromTrack(target.track);
          onClose();
        }}
      >
        <Radio size={14} />
        Start Radio
      </button>
      <button
        type="button"
        className="ctx-item ctx-item--icon"
        onClick={() => {
          dispatch({
            type: "navigate",
            view: {
              name: "similar",
              target: { kind: "track", title: target.track.title, artist: target.track.artistName },
            },
          });
          onClose();
        }}
      >
        <Sparkles size={14} />
        Find similar
      </button>
      {(downloadRecord || libraryId != null) && (
        <>
          <div className="ctx-sep" />
          {downloadRecord ? (
            <button
              type="button"
              className="ctx-item ctx-item--icon"
              onClick={() => void removeTrackDownload()}
            >
              <Trash2 size={14} />
              Remove download
            </button>
          ) : (
            <button
              type="button"
              className="ctx-item ctx-item--icon"
              disabled={offline || libraryId == null}
              title={offline ? OFFLINE_ACTION_TOOLTIP : undefined}
              onClick={() => void downloadTrack()}
            >
              <Download size={14} />
              Download
            </button>
          )}
        </>
      )}
      {pluginActions.length > 0 && (
        <>
          <div className="ctx-sep" />
          {pluginActions.map((a) => {
            const Icon = ACTION_ICONS[a.icon ?? ""] ?? Puzzle;
            return (
              <button
                key={`${a.pluginId}:${a.id}`}
                type="button"
                className="ctx-item ctx-item--icon"
                onClick={() => {
                  void invokePluginAction(a);
                  onClose();
                }}
              >
                <Icon size={14} />
                {a.label}
              </button>
            );
          })}
        </>
      )}
      <div className="ctx-sep" />
      <div
        className="ctx-item ctx-haschild"
        role="menuitem"
        tabIndex={0}
        onMouseEnter={() => setSubmenu(true)}
        onMouseLeave={() => setSubmenu(false)}
      >
        <span>Add to playlist</span>
        <span className="ctx-arrow">
          <ChevronRight size={13} />
        </span>
        {submenu && (
          <div className={`ctx-submenu${submenuLeft ? " ctx-submenu--left" : ""}`}>
            <button
              type="button"
              className="ctx-item ctx-accent"
              onClick={() => onNewPlaylist(target.trackId)}
            >
              + New playlist
            </button>
            {playlists.length > 0 && <div className="ctx-sep" />}
            {playlists.map((p) => (
              <button type="button" key={p.id} className="ctx-item" onClick={() => void add(p)}>
                {p.title}
              </button>
            ))}
          </div>
        )}
      </div>
      {target.playlistContext && (
        <>
          <div className="ctx-sep" />
          <button type="button" className="ctx-item" onClick={() => void removeHere()}>
            Remove from this playlist
          </button>
        </>
      )}
    </div>
  );
}
