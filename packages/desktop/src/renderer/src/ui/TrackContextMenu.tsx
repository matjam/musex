import type { Playlist } from "@musex/core";
import { useEffect, useRef, useState } from "react";
import { usePlaylists } from "../state/playlists";

export interface TrackMenuTarget {
  x: number;
  y: number;
  trackId: string;
  serverId: string;
  /** Provided only when the row is inside a playlist (enables Remove). */
  playlistContext?: { playlistId: string; playlistItemId: string };
}

interface Props {
  target: TrackMenuTarget;
  onClose: () => void;
  onNewPlaylist: (trackId: string) => void; // opens the NewPlaylistDialog seeded with this track
}

export function TrackContextMenu({ target, onClose, onNewPlaylist }: Props) {
  const { playlists, addTo, remove } = usePlaylists();
  const [submenu, setSubmenu] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

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

  async function add(p: Playlist) {
    await addTo(p.id, p.serverId, [target.trackId]);
    onClose();
  }
  async function removeHere() {
    if (!target.playlistContext) return;
    await remove(target.playlistContext.playlistId, target.serverId, [
      target.playlistContext.playlistItemId,
    ]);
    onClose();
  }

  return (
    <div
      ref={ref}
      className="ctx-menu"
      role="menu"
      style={{ left: target.x, top: target.y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div
        className="ctx-item ctx-haschild"
        role="menuitem"
        tabIndex={0}
        onMouseEnter={() => setSubmenu(true)}
        onMouseLeave={() => setSubmenu(false)}
      >
        <span>Add to playlist</span>
        <span className="ctx-arrow">▸</span>
        {submenu && (
          <div className="ctx-submenu">
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
