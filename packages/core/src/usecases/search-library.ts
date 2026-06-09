import type { Library, SearchResults } from "../models/index.js";
import type { PlexGateway } from "../ports/plex-gateway.js";

const EMPTY: SearchResults = { artists: [], albums: [], tracks: [] };

/** Search the active library. A blank/whitespace query short-circuits to empty
 *  results (no gateway call) so the UI can clear without a round-trip. */
export async function searchLibrary(
  gateway: PlexGateway,
  library: Library,
  query: string,
  token: string,
): Promise<SearchResults> {
  const q = query.trim();
  if (q === "") return EMPTY;
  return gateway.search(library, q, token);
}
