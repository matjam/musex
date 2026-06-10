import type { Library, Server } from "../models/index";
import type { PlexGateway } from "../ports/plex-gateway";

export interface LibraryDiscovery {
  libraries: Library[];
  /** Servers that could not be reached; surfaced so the caller (e.g. the main
   *  process adapter) can log or show them, rather than core assuming a logger. */
  unreachable: Server[];
}

/** Lists music libraries across every reachable server. A server that can't be
 *  reached — or that rejects our token (e.g. a server shared with the account
 *  that doesn't honor it) — is recorded in `unreachable` and skipped; one bad
 *  server must never fail the whole discovery. Only an ACCOUNT-level auth
 *  failure (`listServers` itself 401s — bad/expired token) propagates, so the
 *  caller can trigger re-auth. Core does no logging itself (platform-agnostic). */
export async function discoverMusicLibraries(
  gateway: PlexGateway,
  token: string,
): Promise<LibraryDiscovery> {
  const servers = await gateway.listServers(token); // account-level auth errors throw here
  const libraries: Library[] = [];
  const unreachable: Server[] = [];
  for (const server of servers) {
    try {
      libraries.push(...(await gateway.listMusicLibraries(server, token)));
    } catch {
      // Per-server failure (connectivity OR auth) — skip it, keep discovering.
      unreachable.push(server);
    }
  }
  return { libraries, unreachable };
}
