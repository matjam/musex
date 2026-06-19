import { entityRefForArtist, externalArtistRef } from "@musex/core";
import type { SectionDto, SectionItemDto } from "../../../shared/ipc-contract";
import { GridCard } from "./GridCard";
import { useEntityNav } from "./hooks/useEntityNav";

/** Rows of plugin-contributed sections (Discover view + Home). Every item — owned
 *  or unowned — renders the unified card and navigates to the unified artist page
 *  via `resolveEntity`. Owned items get a Plex ref; unowned an external ref (the
 *  card shows the SP0 entity-state badge + Follow affordance). No side panel. */
export function PluginSections({ sections }: { sections: SectionDto[] }) {
  const { goRef } = useEntityNav();

  function open(item: SectionItemDto) {
    if (item.artistId && item.serverId) {
      goRef(entityRefForArtist({ id: item.artistId, serverId: item.serverId, name: item.name }));
    } else {
      goRef(externalArtistRef(item.name));
    }
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
                const entity =
                  item.artistId && item.serverId
                    ? entityRefForArtist({
                        id: item.artistId,
                        serverId: item.serverId,
                        name: item.name,
                      })
                    : externalArtistRef(item.name);
                return (
                  <GridCard
                    key={item.name}
                    thumb={item.imageUrl}
                    title={item.name}
                    subtitle={item.artistName}
                    round
                    entity={entity}
                    onOpen={() => open(item)}
                  />
                );
              })}
            </div>
          </section>
        ))}
    </>
  );
}
