import { X } from "lucide-react";
import { useEffect, useState } from "react";
import type { SectionItemDto } from "../../../shared/ipc-contract";
import { usePlayer } from "../state/player";
import { type SimilarTarget, useSimilar } from "../state/similar";
import { GridCard } from "./GridCard";
import { useEntityNav } from "./hooks/useEntityNav";

type FetchState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ok"; items: SectionItemDto[] };

/** Right-hand panel: similar artists (artist pages) / similar songs (track
 *  detail), tiled, powered by plugin similar-providers. Owned items navigate
 *  or play; unowned show an external badge and link out. Renders nothing when
 *  no similar target is open. */
export function SimilarPanel() {
  const { target, close } = useSimilar();
  const { playTrackNext } = usePlayer();
  const { goArtist, goAlbum } = useEntityNav();
  const [fetch, setFetch] = useState<FetchState>({ status: "loading" });

  // Refetched per target. The cancelled flag guards against a stale (slower)
  // response landing after the target already changed.
  useEffect(() => {
    setFetch({ status: "loading" });
    if (!target) return;
    let cancelled = false;
    window.musex
      .similarGet(target)
      .then((items) => {
        if (!cancelled) setFetch({ status: "ok", items });
      })
      .catch((err: unknown) => {
        console.error("[similar] similarGet failed:", err);
        if (!cancelled) {
          setFetch({
            status: "error",
            message: err instanceof Error ? err.message : "Failed to load similar items",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [target]);

  if (!target) return null;

  function openItem(t: SimilarTarget, item: SectionItemDto) {
    if (t.kind === "artist" && item.artistId && item.serverId) {
      goArtist({ artistId: item.artistId, serverId: item.serverId, artistName: item.name });
      close();
      return;
    }
    if (t.kind === "track" && item.track) {
      goAlbum(item.track);
      close();
      return;
    }
    if (item.externalUrl) void window.musex.openExternal(item.externalUrl);
    // External item without a URL: nothing sensible to open — no-op.
  }

  return (
    <aside className="detail-panel similar-panel">
      <div className="detail-head">
        <span className="detail-head-label">
          {target.kind === "artist" ? "Similar Artists" : "Similar Songs"}
        </span>
        <button type="button" className="detail-close" title="Close" onClick={close}>
          <X size={16} />
        </button>
      </div>

      <div className="similar-seed">{target.kind === "artist" ? target.name : target.title}</div>

      {fetch.status === "loading" && <div className="content-placeholder">Loading similar…</div>}

      {fetch.status === "error" && (
        <div className="content-placeholder error-text">Error: {fetch.message}</div>
      )}

      {fetch.status === "ok" && fetch.items.length === 0 && (
        <div className="content-placeholder">
          No similar results — is a provider plugin connected?
        </div>
      )}

      {fetch.status === "ok" && fetch.items.length > 0 && (
        <div className="similar-grid">
          {fetch.items.map((item) => {
            const track = item.track;
            return (
              <GridCard
                key={`${item.name}:${item.artistName ?? ""}`}
                thumb={track?.thumb ?? item.imageUrl}
                title={item.name}
                subtitle={target.kind === "track" ? item.artistName : undefined}
                round={target.kind === "artist"}
                badge={item.external ? "external" : undefined}
                onOpen={() => openItem(target, item)}
                onPlay={track ? () => playTrackNext(track) : undefined}
              />
            );
          })}
        </div>
      )}
    </aside>
  );
}
