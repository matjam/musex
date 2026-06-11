import { Download } from "lucide-react";
import { useEffect, useState } from "react";
import type { SectionDto, SectionItemDto } from "../../../shared/ipc-contract";
import { useApp } from "../state/app";
import { usePanel } from "../state/panel";
import { GridCard } from "./GridCard";
import { useAcquisitionAvailable } from "./hooks/useAcquisitionAvailable";

/** Rows of plugin-contributed sections (Discover view + Home). Library-matched
 *  items navigate to their artist page; external items open the artist-info
 *  side panel (with inline monitor) when an acquisition provider is
 *  registered, else link out via externalUrl (when present). */
export function PluginSections({ sections }: { sections: SectionDto[] }) {
  const { dispatch } = useApp();
  const { openArtistInfo } = usePanel();
  const acquisitionAvailable = useAcquisitionAvailable();
  const [monitored, setMonitored] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!acquisitionAvailable) return;
    let cancelled = false;
    window.musex
      .acquisitionMonitoredArtists()
      .then((names) => {
        if (!cancelled) setMonitored(new Set(names.map((n) => n.toLowerCase())));
      })
      .catch(() => {
        // badges only — sections render fine without them
      });
    return () => {
      cancelled = true;
    };
  }, [acquisitionAvailable]);

  function open(item: SectionItemDto) {
    if (item.artistId && item.serverId) {
      dispatch({
        type: "navigate",
        view: {
          name: "artist",
          artist: { id: item.artistId, serverId: item.serverId, name: item.name },
        },
      });
    } else if (acquisitionAvailable) {
      openArtistInfo(item.name);
    } else if (item.externalUrl) {
      void window.musex.openExternal(item.externalUrl);
    }
    // External item without a URL or acquisition provider: no-op.
  }

  function monitor(item: SectionItemDto) {
    // Optimistic badge flip; the plugin toasts success/failure.
    setMonitored((prev) => new Set(prev).add(item.name.toLowerCase()));
    window.musex.acquisitionAcquireArtistByName(item.name).catch((err: unknown) => {
      console.error("[acquisition] acquireArtistByName failed:", err);
      setMonitored((prev) => {
        const next = new Set(prev);
        next.delete(item.name.toLowerCase());
        return next;
      });
    });
  }

  return (
    <>
      {sections
        .filter((s) => s.items.length > 0)
        .map((s) => (
          <section className="home-row" key={`${s.pluginId}:${s.title}`}>
            <h3 className="browse-title">{s.title}</h3>
            <div className="browse-grid">
              {s.items.map((item) => {
                const external = Boolean(item.external);
                const isMonitored = external && monitored.has(item.name.toLowerCase());
                const canMonitor = external && acquisitionAvailable && !isMonitored;
                return (
                  <GridCard
                    key={item.name}
                    thumb={item.imageUrl}
                    title={item.name}
                    subtitle={item.artistName}
                    round
                    badge={isMonitored ? "monitored" : external ? "external" : undefined}
                    badgeVariant={isMonitored ? "monitored" : undefined}
                    onOpen={() => open(item)}
                    actionIcon={canMonitor ? Download : undefined}
                    actionTitle="Monitor artist — download their music"
                    onAction={canMonitor ? () => monitor(item) : undefined}
                  />
                );
              })}
            </div>
          </section>
        ))}
    </>
  );
}
