import { Download } from "lucide-react";
import { useEffect, useState } from "react";
import type { AcquirableAlbumDto } from "../../../shared/ipc-contract";
import { useApp } from "../state/app";
import { GridCard } from "./GridCard";
import { useAcquisitionAvailable } from "./hooks/useAcquisitionAvailable";

type FetchState = { status: "idle" } | { status: "ok"; albums: AcquirableAlbumDto[] };

/** "Not in your library" section for an owned artist's page: the merged
 *  external discography (last.fm ∪ acquisition providers) minus owned albums,
 *  with per-album monitor actions. Hidden entirely when no acquisition
 *  provider is enabled or nothing is missing. */
export function MissingAlbumsSection({ artistName }: { artistName: string }) {
  const { connectivity } = useApp();
  const offline = connectivity === "offline";
  const acquisitionAvailable = useAcquisitionAvailable();
  const [fetch, setFetch] = useState<FetchState>({ status: "idle" });

  useEffect(() => {
    // Online-only plugin lookup; skip offline (the section self-hides since it
    // renders null with no albums).
    if (!acquisitionAvailable || offline) {
      setFetch({ status: "idle" });
      return;
    }
    let cancelled = false;
    setFetch({ status: "idle" });
    window.musex
      .acquisitionDiscography(artistName)
      .then((albums) => {
        if (cancelled) return;
        setFetch({ status: "ok", albums: albums.filter((a) => a.state !== "owned") });
      })
      .catch(() => {
        // discovery section is best-effort — hidden on failure
      });
    return () => {
      cancelled = true;
    };
  }, [artistName, acquisitionAvailable, offline]);

  if (fetch.status !== "ok" || fetch.albums.length === 0) return null;

  function acquire(album: AcquirableAlbumDto) {
    // Optimistic flip to "requested"; revert on failure (plugin toasts).
    setFetch((prev) =>
      prev.status === "ok"
        ? {
            status: "ok",
            albums: prev.albums.map((a) =>
              a.providerId === album.providerId && a.providerRef === album.providerRef
                ? { ...a, state: "requested" as const }
                : a,
            ),
          }
        : prev,
    );
    window.musex
      .acquisitionAcquire({ providerId: album.providerId, providerRef: album.providerRef })
      .catch((err: unknown) => {
        console.error("[acquisition] acquire failed:", err);
        setFetch((prev) =>
          prev.status === "ok"
            ? {
                status: "ok",
                albums: prev.albums.map((a) =>
                  a.providerId === album.providerId && a.providerRef === album.providerRef
                    ? { ...a, state: "available" as const }
                    : a,
                ),
              }
            : prev,
        );
      });
  }

  return (
    <section className="home-row">
      <h3 className="browse-title">Not in your library</h3>
      <div className="browse-grid">
        {fetch.albums.map((album) => (
          <GridCard
            key={`${album.providerId}:${album.providerRef}`}
            thumb={album.imageUrl}
            title={album.title}
            subtitle={album.year != null ? String(album.year) : undefined}
            state={album.state}
            dim={album.state === "unavailable"}
            onOpen={() => {}}
            actionIcon={album.state === "available" ? Download : undefined}
            actionTitle="Monitor album — download it"
            onAction={album.state === "available" ? () => acquire(album) : undefined}
          />
        ))}
      </div>
    </section>
  );
}
