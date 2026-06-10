import type { SectionDto, SectionItemDto } from "../../../shared/ipc-contract";
import { useApp } from "../state/app";
import { GridCard } from "./GridCard";
import { useAcquisitionAvailable } from "./hooks/useAcquisitionAvailable";

/** Rows of plugin-contributed sections (Discover view + Home), rendered with
 *  the same browse-grid/GridCard machinery as the built-in artist rows.
 *  Library-matched items navigate to their artist page; external items open
 *  the in-app External Artist view when an acquisition provider (Lidarr) is
 *  registered, else link out via externalUrl (when present). */
export function PluginSections({ sections }: { sections: SectionDto[] }) {
  const { dispatch } = useApp();
  const acquisitionAvailable = useAcquisitionAvailable();

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
      dispatch({
        type: "navigate",
        view: { name: "external-artist", artistName: item.name },
      });
    } else if (item.externalUrl) {
      void window.musex.openExternal(item.externalUrl);
    }
    // External item without a URL or acquisition provider: no-op.
  }

  return (
    <>
      {sections
        .filter((s) => s.items.length > 0)
        .map((s) => (
          <section className="home-row" key={`${s.pluginId}:${s.title}`}>
            <h3 className="browse-title">{s.title}</h3>
            <div className="browse-grid">
              {s.items.map((item) => (
                <GridCard
                  key={item.name}
                  thumb={item.imageUrl}
                  title={item.name}
                  subtitle={item.artistName}
                  round
                  badge={item.external ? "external" : undefined}
                  onOpen={() => open(item)}
                />
              ))}
            </div>
          </section>
        ))}
    </>
  );
}
