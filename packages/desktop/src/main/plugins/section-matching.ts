import type { Artist } from "@musex/core";
import type { Section } from "@musex/plugin-api";
import type { SectionDto, SectionItemDto } from "../../shared/ipc-contract.js";

/**
 * Enrich plugin-provided artist items with library-match results: a
 * case-insensitive exact artist-name match gains `artistId`/`serverId` (the
 * renderer navigates to the artist); anything unmatched is flagged `external`
 * (badge + externalUrl link-out). Plugins never see any of this — it's purely
 * a host/renderer concern. Shared by the Discover/Home sections and the
 * Similar-artists panel.
 */
export function matchItemsAgainstLibrary(
  items: { name: string; artistName?: string; imageUrl?: string; externalUrl?: string }[],
  artists: Artist[],
): SectionItemDto[] {
  const byName = new Map<string, Artist>();
  for (const a of artists) {
    const key = a.name.toLowerCase();
    if (!byName.has(key)) byName.set(key, a);
  }
  return items.map((item) => {
    const match = byName.get(item.name.toLowerCase());
    return match
      ? { ...item, artistId: match.id, serverId: match.serverId }
      : { ...item, external: true };
  });
}

/** Section-shaped wrapper over matchItemsAgainstLibrary: flatten plugin
 *  sections to the wire shape with per-item match enrichment. */
export function matchSectionsAgainstLibrary(
  results: { pluginId: string; sections: Section[] }[],
  artists: Artist[],
): SectionDto[] {
  const out: SectionDto[] = [];
  for (const { pluginId, sections } of results) {
    for (const section of sections) {
      out.push({
        pluginId,
        title: section.title,
        items: matchItemsAgainstLibrary(section.items, artists),
      });
    }
  }
  return out;
}
