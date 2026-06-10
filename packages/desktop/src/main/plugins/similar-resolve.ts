import type { Track } from "@musex/core";
import type { SimilarItem } from "@musex/plugin-api";
import type { SectionItemDto } from "../../shared/ipc-contract.js";

/**
 * Resolve Similar-SONGS items against the user's library, the same way radio
 * suggestions resolve: search `"artist title"` and take the first result with
 * a case-insensitive artist+title match. Owned items carry the full playable
 * `track` (the caller bakes its thumb); everything else — no artistName, no
 * match, or a failed search (logged; one bad query must not kill the batch) —
 * is flagged `external`. Searches run sequentially (items are already capped
 * upstream) so one panel open never floods the Plex server.
 */
export async function resolveSimilarTracks(
  items: SimilarItem[],
  search: (query: string) => Promise<{ tracks: Track[] }>,
): Promise<SectionItemDto[]> {
  const out: SectionItemDto[] = [];
  for (const item of items) {
    const artist = item.artistName;
    if (artist === undefined || artist.length === 0) {
      out.push({ ...item, external: true });
      continue;
    }
    let tracks: Track[];
    try {
      tracks = (await search(`${artist} ${item.name}`)).tracks;
    } catch (err) {
      console.error(`[similar] library search failed for "${artist} – ${item.name}":`, err);
      out.push({ ...item, external: true });
      continue;
    }
    const wantArtist = artist.toLowerCase();
    const wantTitle = item.name.toLowerCase();
    const match = tracks.find(
      (t) => t.artistName.toLowerCase() === wantArtist && t.title.toLowerCase() === wantTitle,
    );
    out.push(match ? { ...item, track: match } : { ...item, external: true });
  }
  return out;
}
