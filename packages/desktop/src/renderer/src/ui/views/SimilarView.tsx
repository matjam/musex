import { useEffect, useState } from "react";
import type { SectionItemDto, SimilarGetArgs } from "../../../../shared/ipc-contract";
import { useApp } from "../../state/app";
import { usePlayer } from "../../state/player";
import { GridCard } from "../GridCard";
import { useAcquisitionAvailable } from "../hooks/useAcquisitionAvailable";
import { useEntityNav } from "../hooks/useEntityNav";

type FetchState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ok"; items: SectionItemDto[] };

/** Main-content view: similar artists (artist pages) / similar songs (track
 *  detail), tiled, powered by plugin similar-providers. Owned items navigate
 *  or play; unowned show an external badge and link out (or open the in-app
 *  external-artist discography when an acquisition provider is registered). */
export function SimilarView({ target }: { target: SimilarGetArgs }) {
  const { dispatch } = useApp();
  const { playTrackNext } = usePlayer();
  const { goArtist, goAlbum } = useEntityNav();
  const acquisitionAvailable = useAcquisitionAvailable();
  const [fetch, setFetch] = useState<FetchState>({ status: "loading" });

  // Refetched per target. The cancelled flag guards against a stale (slower)
  // response landing after the target already changed.
  useEffect(() => {
    setFetch({ status: "loading" });
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

  function openItem(item: SectionItemDto) {
    if (target.kind === "artist" && item.artistId && item.serverId) {
      goArtist({ artistId: item.artistId, serverId: item.serverId, artistName: item.name });
      return;
    }
    if (target.kind === "track" && item.track) {
      goAlbum(item.track);
      return;
    }
    if (target.kind === "artist" && acquisitionAvailable) {
      // External artist + acquisition provider registered → in-app discography.
      dispatch({ type: "navigate", view: { name: "external-artist", artistName: item.name } });
      return;
    }
    if (item.externalUrl) void window.musex.openExternal(item.externalUrl);
    // External item without a URL or acquisition provider: no-op.
  }

  const heading =
    target.kind === "artist"
      ? `Similar Artists — ${target.name}`
      : `Similar Songs — ${target.title} · ${target.artist}`;

  return (
    <div className="browse-section">
      <h3 className="browse-title">{heading}</h3>
      <div className="browse-sub">
        Powered by similar-provider plugins — owned items open in your library.
      </div>

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
        <div className="browse-grid">
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
                onOpen={() => openItem(item)}
                onPlay={track ? () => playTrackNext(track) : undefined}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
