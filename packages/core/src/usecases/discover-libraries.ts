import type { Library } from "../models/index";
import type { PlexGateway } from "../ports/plex-gateway";

/** Lists music libraries across every reachable server. An unreachable server is
 *  logged and skipped (not swallowed silently) rather than failing discovery. */
export async function discoverMusicLibraries(
  gateway: PlexGateway,
  token: string,
): Promise<Library[]> {
  const servers = await gateway.listServers(token);
  const libraries: Library[] = [];
  for (const server of servers) {
    try {
      const libs = await gateway.listMusicLibraries(server, token);
      libraries.push(...libs);
    } catch (err) {
      console.warn(`musex: skipping unreachable server "${server.name}" (${server.id})`, err);
    }
  }
  return libraries;
}
