import type { AcquisitionStatusDto } from "../../../shared/ipc-contract";
import type { AcquisitionBadgeState } from "../ui/discovery/state-badge";

/** States that mean "this item is actively being acquired" — i.e. worth a
 *  badge / inclusion in the Acquiring filter. "owned"/"available" describe
 *  library/lookup status rather than in-flight acquisition, so they don't
 *  count as acquiring. */
const ACQUIRING_STATES: ReadonlySet<AcquisitionBadgeState> = new Set([
  "requested",
  "downloading",
  "downloaded",
]);

/** Higher = more informative / "further along". When an artist has several
 *  albums in different states, the artist tile collapses to the highest. */
const STATE_RANK: Record<AcquisitionBadgeState, number> = {
  downloading: 4,
  requested: 3,
  downloaded: 2,
  available: 1,
  owned: 0,
  unavailable: 0,
};

/** Normalize a name to the project-wide cross-check key (matches the
 *  acquisition/discography/monitoring code: trim + lowercase). */
export function acquisitionKey(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Build a `key → acquisition badge state` map from the flat acquisition status
 * rows (each row is album-granular: `{ title, artistName, state, … }`).
 *
 * - `keyField: "title"` keys by ALBUM title — exact per-album state (Albums view).
 * - `keyField: "artistName"` keys by ARTIST name — an artist rolls up to the
 *   "furthest along" acquiring album it has (Artists view, where rows are
 *   album-level but the grid is artist-level).
 *
 * Only rows in an *acquiring* state (requested/downloading/downloaded) are
 * included — "owned"/"available"/"unavailable" rows are noise for a badge.
 * Keys are normalized via {@link acquisitionKey}.
 */
export function buildAcquisitionMap(
  rows: AcquisitionStatusDto[],
  keyField: "title" | "artistName",
): Map<string, AcquisitionBadgeState> {
  const map = new Map<string, AcquisitionBadgeState>();
  for (const row of rows) {
    const state = row.state as AcquisitionBadgeState;
    if (!ACQUIRING_STATES.has(state)) continue;
    const raw = row[keyField];
    if (!raw) continue;
    const key = acquisitionKey(raw);
    const existing = map.get(key);
    if (existing === undefined || STATE_RANK[state] > STATE_RANK[existing]) {
      map.set(key, state);
    }
  }
  return map;
}

/** Look up an item's acquisition state by name (normalized), or undefined. */
export function acquisitionStateFor(
  map: Map<string, AcquisitionBadgeState>,
  name: string,
): AcquisitionBadgeState | undefined {
  return map.get(acquisitionKey(name));
}
