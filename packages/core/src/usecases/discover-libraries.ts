import type { Library, Server } from "../models/index";
import type { PlexGateway } from "../ports/plex-gateway";
import { PlexAuthError } from "../ports/plex-gateway";

export interface LibraryDiscovery {
  libraries: Library[];
  /** Servers that could not be reached; surfaced so the caller (e.g. the main
   *  process adapter) can log or show them, rather than core assuming a logger. */
  unreachable: Server[];
}

/** Lists music libraries across every reachable server. A server that can't be
 *  reached is recorded in `unreachable` and skipped — not silently swallowed, and
 *  not fatal to the whole discovery. An auth failure (bad/expired token) is
 *  re-thrown so the caller can trigger re-auth, since it is not a per-server
 *  connectivity problem. Core does no logging itself (platform-agnostic). */
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
    } catch (err) {
      if (err instanceof PlexAuthError) throw err;
      unreachable.push(server);
    }
  }
  return { libraries, unreachable };
}
