import type { Artist } from "@musex/core";
import type { Section } from "@musex/plugin-api";
import type { SectionDto, SectionItemDto } from "../../shared/ipc-contract.js";

/**
 * Enrich plugin-provided sections with library-match results and flatten them
 * to the wire shape: a case-insensitive exact artist-name match gains
 * `artistId`/`serverId` (the renderer navigates to the artist); anything
 * unmatched is flagged `external` (badge + externalUrl link-out). Plugins
 * never see any of this — it's purely a host/renderer concern.
 */
export function matchSectionsAgainstLibrary(
  results: { pluginId: string; sections: Section[] }[],
  artists: Artist[],
): SectionDto[] {
  const byName = new Map<string, Artist>();
  for (const a of artists) {
    const key = a.name.toLowerCase();
    if (!byName.has(key)) byName.set(key, a);
  }
  const out: SectionDto[] = [];
  for (const { pluginId, sections } of results) {
    for (const section of sections) {
      const items: SectionItemDto[] = section.items.map((item) => {
        const match = byName.get(item.name.toLowerCase());
        return match
          ? { ...item, artistId: match.id, serverId: match.serverId }
          : { ...item, external: true };
      });
      out.push({ pluginId, title: section.title, items });
    }
  }
  return out;
}
