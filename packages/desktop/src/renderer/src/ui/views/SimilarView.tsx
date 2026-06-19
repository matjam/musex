import { entityRefForArtist, externalArtistRef } from "@musex/core";
import { useEffect, useState } from "react";
import type { SectionItemDto, SimilarGetArgs } from "../../../../shared/ipc-contract";
import { usePlayer } from "../../state/player";
import { GridCard } from "../GridCard";
import { useEntityNav } from "../hooks/useEntityNav";

type FetchState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ok"; items: SectionItemDto[] };

/** Main-content view: similar artists (artist pages) / similar songs (track
 *  detail), tiled, powered by plugin similar-providers. Every item — owned or
 *  unowned — navigates to its unified page via `resolveEntity` (the card shows
 *  the SP0 badge + Follow affordance for unowned); track-kind items play. No
 *  external-URL/external-view divergence, no side panel. */
export function SimilarView({ target }: { target: SimilarGetArgs }) {
  const { playTrackNext } = usePlayer();
  const { goRef, goAlbum } = useEntityNav();
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
    if (target.kind === "track" && item.track) {
      // A similar SONG navigates to its album page (tracks have no page).
      goAlbum(item.track);
      return;
    }
    // A similar ARTIST always navigates to the unified artist page — owned
    // (Plex ref) or unowned (external ref). The path no longer matters.
    if (item.artistId && item.serverId) {
      goRef(entityRefForArtist({ id: item.artistId, serverId: item.serverId, name: item.name }));
    } else {
      goRef(externalArtistRef(item.name));
    }
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
            // Artist-kind similar items resolve to an artist ref (owned when the
            // library matched it, else external) so the card shows the SP0
            // badge + Follow affordance; track-kind items just play.
            const entity =
              target.kind === "artist"
                ? item.artistId && item.serverId
                  ? entityRefForArtist({
                      id: item.artistId,
                      serverId: item.serverId,
                      name: item.name,
                    })
                  : externalArtistRef(item.name)
                : undefined;
            return (
              <GridCard
                key={`${item.name}:${item.artistName ?? ""}`}
                thumb={track?.thumb ?? item.imageUrl}
                title={item.name}
                subtitle={target.kind === "track" ? item.artistName : undefined}
                round={target.kind === "artist"}
                entity={entity}
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
