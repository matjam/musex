import { useState } from "react";
import { usePlaylists } from "../state/playlists";

interface Props {
  seedTrackIds: string[]; // [] for an empty playlist from the sidebar "+"
  onClose: () => void;
  onCreated?: (playlistId: string, serverId: string) => void;
}

export function NewPlaylistDialog({ seedTrackIds, onClose, onCreated }: Props) {
  const { create } = usePlaylists();
  const [title, setTitle] = useState("");
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
      const p = await create(t, seedTrackIds);
      onCreated?.(p.id, p.serverId);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create playlist");
      setBusy(false);
    }
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: backdrop closes modal on outside click — this is standard dialog dismiss pattern
    <div
      className="modal-backdrop"
      onClick={onClose}
      onKeyDown={(e) => e.key === "Escape" && onClose()}
    >
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: stopPropagation only; keyboard handled by backdrop above */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: same — this is the dialog container, not an interactive element */}
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal-title">New playlist</h3>
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
            {busy ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
