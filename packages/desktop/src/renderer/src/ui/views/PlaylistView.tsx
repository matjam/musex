import type { Playlist, PlaylistTrack } from "@musex/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "../../state/app";
import { usePlayer } from "../../state/player";
import { usePlaylists } from "../../state/playlists";
import { AlbumArt } from "../AlbumArt";
import { NewPlaylistDialog } from "../NewPlaylistDialog";
import type { TrackMenuTarget } from "../TrackContextMenu";
import { TrackContextMenu } from "../TrackContextMenu";
import { TrackRow } from "../TrackRow";

type FetchState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ok"; items: PlaylistTrack[] };

interface RenameDialogProps {
  current: string;
  onClose: () => void;
  onConfirm: (title: string) => Promise<void>;
}

function RenameDialog({ current, onClose, onConfirm }: RenameDialogProps) {
  const [title, setTitle] = useState(current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const t = title.trim();
    if (t === "") {
      setError("Please enter a name");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onConfirm(t);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not rename playlist");
      setBusy(false);
    }
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: backdrop closes modal on outside click — standard dialog dismiss pattern
    <div
      className="modal-backdrop"
      onClick={onClose}
      onKeyDown={(e) => e.key === "Escape" && onClose()}
    >
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: stopPropagation only; keyboard handled by backdrop above */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: dialog container, not an interactive element */}
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal-title">Rename playlist</h3>
        <input
          className="modal-input"
          // biome-ignore lint/a11y/noAutofocus: focus the only field in a just-opened dialog
          autoFocus
          placeholder="Playlist name"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void submit()}
        />
        {error && <div className="modal-error">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="settings-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="modal-create"
            disabled={busy}
            onClick={() => void submit()}
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Small inline popover for playlist-level actions (rename / delete). */
interface ActionsMenuProps {
  x: number;
  y: number;
  onClose: () => void;
  onRename: () => void;
  onDelete: () => void;
}

function PlaylistActionsMenu({ x, y, onClose, onRename, onDelete }: ActionsMenuProps) {
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

  return (
    <div
      ref={ref}
      className="ctx-menu"
      role="menu"
      style={{ left: x, top: y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <button
        type="button"
        className="ctx-item"
        role="menuitem"
        onClick={() => {
          onClose();
          onRename();
        }}
      >
        Rename
      </button>
      <div className="ctx-sep" />
      <button
        type="button"
        className="ctx-item ctx-danger"
        role="menuitem"
        onClick={() => {
          onClose();
          onDelete();
        }}
      >
        Delete playlist
      </button>
    </div>
  );
}

interface Props {
  playlist: Playlist;
}

export function PlaylistView({ playlist }: Props) {
  const { dispatch } = useApp();
  const { state, playTracks } = usePlayer();
  const { rename, destroy } = usePlaylists();

  const [fetch, setFetch] = useState<FetchState>({ status: "loading" });
  const [menu, setMenu] = useState<TrackMenuTarget | null>(null);
  const [newSeed, setNewSeed] = useState<string[] | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [actionsPos, setActionsPos] = useState<{ x: number; y: number } | null>(null);
  // Local title tracks the header; the store's refresh() updates the sidebar rail.
  const [localTitle, setLocalTitle] = useState(playlist.title);

  const load = useCallback(() => {
    setFetch({ status: "loading" });
    window.musex
      .listPlaylistTracks(playlist.id, playlist.serverId)
      .then((items) => setFetch({ status: "ok", items }))
      .catch((err: unknown) =>
        setFetch({
          status: "error",
          message: err instanceof Error ? err.message : "Failed to load tracks",
        }),
      );
  }, [playlist.id, playlist.serverId]);

  useEffect(() => {
    load();
  }, [load]);

  // Sync localTitle when navigating to a different playlist.
  useEffect(() => {
    setLocalTitle(playlist.title);
  }, [playlist.title]);

  const playingTrackId =
    state.queue != null ? (state.queue.tracks[state.queue.index]?.id ?? null) : null;

  const items = fetch.status === "ok" ? fetch.items : [];
  const tracks = items.map((pt) => pt.track);
  const totalMs = tracks.reduce((sum, t) => sum + t.durationMs, 0);
  const totalMin = Math.round(totalMs / 60000);

  async function handleRename(newTitle: string) {
    await rename(playlist.id, playlist.serverId, newTitle);
    setLocalTitle(newTitle);
  }

  async function handleDelete() {
    await destroy(playlist.id, playlist.serverId);
    dispatch({ type: "navigate", view: { name: "artists" } });
  }

  return (
    <div className="album-detail">
      <div className="album-header">
        <AlbumArt thumb={playlist.thumb} className="album-header-art" />
        <div className="album-header-meta">
          <div className="album-meta-label">Playlist</div>
          <h1 className="album-meta-title">{localTitle}</h1>
          <div className="album-meta-by">
            {fetch.status === "ok" && (
              <span className="album-meta-muted">
                {items.length} song{items.length !== 1 ? "s" : ""} · {totalMin} min
              </span>
            )}
          </div>
          <div className="album-actions">
            {fetch.status === "ok" && tracks.length > 0 && (
              <button
                type="button"
                className="play-btn"
                title="Play playlist"
                onClick={() => playTracks(tracks, 0)}
              >
                ▶
              </button>
            )}
            <button
              type="button"
              className="playlist-actions-btn"
              title="Playlist options"
              onClick={(e) => {
                e.stopPropagation();
                setActionsPos({ x: e.clientX, y: e.clientY });
              }}
            >
              ⋯
            </button>
          </div>
        </div>
      </div>

      {fetch.status === "loading" && <div className="content-placeholder">Loading tracks…</div>}

      {fetch.status === "error" && (
        <div className="content-placeholder error-text">Error: {fetch.message}</div>
      )}

      {fetch.status === "ok" && items.length === 0 && (
        <div className="content-placeholder">No tracks in this playlist.</div>
      )}

      {fetch.status === "ok" && items.length > 0 && (
        <div className="track-list">
          {items.map((pt, i) => (
            <TrackRow
              key={pt.playlistItemId}
              track={pt.track}
              leading={i + 1}
              isPlaying={pt.track.id === playingTrackId}
              onPlay={() => playTracks(tracks, i)}
              onMenu={(pos) =>
                setMenu({
                  ...pos,
                  trackId: pt.track.id,
                  serverId: pt.track.serverId,
                  playlistContext: {
                    playlistId: playlist.id,
                    playlistItemId: pt.playlistItemId,
                  },
                })
              }
            />
          ))}
        </div>
      )}

      {menu !== null && (
        <TrackContextMenu
          target={menu}
          onClose={() => setMenu(null)}
          onNewPlaylist={(id) => {
            setNewSeed([id]);
            setMenu(null);
          }}
          onChanged={load}
        />
      )}

      {actionsPos !== null && (
        <PlaylistActionsMenu
          x={actionsPos.x}
          y={actionsPos.y}
          onClose={() => setActionsPos(null)}
          onRename={() => setRenaming(true)}
          onDelete={() => void handleDelete()}
        />
      )}

      {newSeed !== null && (
        <NewPlaylistDialog seedTrackIds={newSeed} onClose={() => setNewSeed(null)} />
      )}

      {renaming && (
        <RenameDialog
          current={localTitle}
          onClose={() => setRenaming(false)}
          onConfirm={handleRename}
        />
      )}
    </div>
  );
}
