import type { Library, Playlist } from "../models/index.js";
import type { PlexGateway } from "../ports/plex-gateway.js";

/** Create a playlist after validating the title. Trims; rejects empty titles. */
export async function createPlaylist(
  gateway: PlexGateway,
  library: Library,
  title: string,
  trackIds: string[],
  token: string,
): Promise<Playlist> {
  const trimmed = title.trim();
  if (trimmed === "") throw new Error("Playlist title is required");
  if (trackIds.length === 0) throw new Error("A playlist needs at least one track");
  return gateway.createPlaylist(library, trimmed, trackIds, token);
}
