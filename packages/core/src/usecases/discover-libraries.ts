import type { Library, Server } from "../models/index";
import type { PlexGateway } from "../ports/plex-gateway";

export interface LibraryDiscovery {
  libraries: Library[];
  /** Servers that could not be reached; surfaced so the caller (e.g. the main
   *  process adapter) can log or show them, rather than core assuming a logger. */
  unreachable: Server[];
}

/** Lists music libraries across every reachable server. A server that can't be
 *  reached is recorded in `unreachable` and skipped — not silently swallowed, and
 *  not fatal to the whole discovery. Core does no logging itself (stays platform-agnostic). */
export async function discoverMusicLibraries(
  gateway: PlexGateway,
  token: string,
): Promise<LibraryDiscovery> {
  const servers = await gateway.listServers(token);
  const libraries: Library[] = [];
  const unreachable: Server[] = [];
  for (const server of servers) {
    try {
      libraries.push(...(await gateway.listMusicLibraries(server, token)));
    } catch {
      unreachable.push(server);
    }
  }
  return { libraries, unreachable };
}
