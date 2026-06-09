import type { Playlist } from "@musex/core";

export function PlaylistView({ playlist }: { playlist: Playlist }) {
  return <div className="content-placeholder">Loading "{playlist.title}"…</div>;
}
