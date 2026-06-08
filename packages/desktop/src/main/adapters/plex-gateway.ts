import type {
  MusicSection,
  Album as PlexAlbum,
  Artist as PlexArtist,
  PlexServer,
  Track as PlexTrack,
} from "@ctrl/plex";
import { MyPlexAccount } from "@ctrl/plex";
import { fetchItem } from "@ctrl/plex/dist/src/baseFunctionality.js";
import { BASE_HEADERS } from "@ctrl/plex/dist/src/config.js";
import type { Album, Artist, Library, Pin, PlexGateway, Server, Track } from "@musex/core";
import { PlexAuthError } from "@musex/core";
import { toAlbum, toArtist, toTrack } from "../../logic/plex-mapping.js";
import { getClientId } from "./persistence.js";

const PRODUCT = "musex";

/** Override the global @ctrl/plex client identity once at startup so all
 *  requests carry the stable per-install client ID and the correct product name.
 *  BASE_HEADERS is typed readonly but is a plain mutable JS object at runtime. */
export function initPlexIdentity(): void {
  (BASE_HEADERS as Record<string, string>)["X-Plex-Client-Identifier"] = getClientId();
  (BASE_HEADERS as Record<string, string>)["X-Plex-Product"] = PRODUCT;
}

/** Translate @ctrl/plex ofetch HTTP errors into PlexAuthError where appropriate.
 *  ofetch throws an object with a `response.status` number for HTTP errors. */
function asPlexAuthError(err: unknown): never {
  if (
    typeof err === "object" &&
    err !== null &&
    "response" in err &&
    typeof (err as { response?: { status?: number } }).response?.status === "number"
  ) {
    const status = (err as { response: { status: number } }).response.status;
    if (status === 401 || status === 403) throw new PlexAuthError();
  }
  throw err;
}

export class PlexapiGateway implements PlexGateway {
  /** Cache connected PlexServer objects by Plex machine identifier so browse
   *  calls reuse the same connection within a gateway instance lifetime. */
  private readonly serverCache = new Map<string, PlexServer>();

  async createPin(): Promise<Pin> {
    // WebLogin shape: { id: number, code: string, uri: string }
    const web = await MyPlexAccount.getWebLogin();
    return { id: String(web.id), code: web.code, authUrl: web.uri };
  }

  async pollPin(id: string): Promise<{ authToken: string | null }> {
    // Single-shot poll — the core signIn use-case owns the loop/timeout.
    const res = await fetch(`https://plex.tv/api/v2/pins/${id}`, {
      headers: {
        accept: "application/json",
        "X-Plex-Client-Identifier": getClientId(),
        "X-Plex-Product": PRODUCT,
      },
    });
    if (res.status === 401 || res.status === 403) throw new PlexAuthError();
    if (!res.ok) return { authToken: null };
    const body = (await res.json()) as { authToken: string | null };
    return { authToken: body.authToken ?? null };
  }

  async listServers(token: string): Promise<Server[]> {
    try {
      const account = this.account(token);
      const resources = await account.resources();
      return resources
        .filter((r) => r.provides?.includes("server"))
        .map((r) => ({
          id: r.clientIdentifier,
          name: r.name,
          // ResourceConnection exposes uri + local; relay is in the raw Connection
          // data only. Default relay to false — callers should prefer local connections.
          connections: (r.connections ?? []).map((c) => ({
            uri: c.uri,
            local: Boolean(c.local),
            relay: false,
          })),
        }));
    } catch (err) {
      asPlexAuthError(err);
    }
  }

  async listMusicLibraries(server: Server, token: string): Promise<Library[]> {
    try {
      const plexServer = await this.connect(server.id, token);
      const library = await plexServer.library();
      const sections = await library.sections();
      return sections
        .filter((s) => s.type === "artist") // music sections have type "artist"
        .map((s) => ({
          id: String(s.key),
          serverId: server.id,
          serverName: server.name,
          title: s.title,
          type: "music" as const,
        }));
    } catch (err) {
      asPlexAuthError(err);
    }
  }

  async listArtists(library: Library, token: string): Promise<Artist[]> {
    try {
      const section = await this.musicSection(library, token);
      const artists = await section.searchArtists();
      return artists.map((a) => toArtistSafe(a, library.serverId));
    } catch (err) {
      asPlexAuthError(err);
    }
  }

  async listAlbums(library: Library, artistId: string, token: string): Promise<Album[]> {
    try {
      const plexServer = await this.connect(library.serverId, token);
      const artist = await fetchItem<PlexArtist>(plexServer, `/library/metadata/${artistId}`);
      const albums = await artist.albums();
      return albums.map((al) => toAlbumSafe(al, library.serverId));
    } catch (err) {
      asPlexAuthError(err);
    }
  }

  async listTracks(library: Library, albumId: string, token: string): Promise<Track[]> {
    try {
      const plexServer = await this.connect(library.serverId, token);
      const album = await fetchItem<PlexAlbum>(plexServer, `/library/metadata/${albumId}`);
      const tracks = await album.tracks();
      return tracks.map((t) => toTrackSafe(t, library.serverId));
    } catch (err) {
      asPlexAuthError(err);
    }
  }

  // --- internal helpers ---

  private account(token: string): MyPlexAccount {
    return new MyPlexAccount({ token });
  }

  /** Connect to a Plex server by its machine identifier, caching the result. */
  private async connect(serverId: string, token: string): Promise<PlexServer> {
    const cached = this.serverCache.get(serverId);
    if (cached) return cached;

    const account = this.account(token);
    const resources = await account.resources();
    const resource = resources.find((r) => r.clientIdentifier === serverId);
    if (!resource) throw new Error(`Plex server ${serverId} not found for this account`);
    const plexServer = await resource.connect();
    this.serverCache.set(serverId, plexServer);
    return plexServer;
  }

  private async musicSection(library: Library, token: string): Promise<MusicSection> {
    const plexServer = await this.connect(library.serverId, token);
    const lib = await plexServer.library();
    return lib.sectionByID<MusicSection>(Number(library.id));
  }
}

// --- thin adapters from @ctrl/plex concrete types to the mapper's raw interfaces ---
// These exist because @ctrl/plex uses `number | string | undefined` for ratingKey and
// other optional fields, while our mappers require `string`. We do the coercions here
// so the tested mappers stay unchanged.

function toArtistSafe(a: PlexArtist, serverId: string): Artist {
  return toArtist(
    {
      ratingKey: String(a.ratingKey ?? ""),
      title: a.title ?? "",
      thumb: a.thumb,
    },
    serverId,
  );
}

function toAlbumSafe(al: PlexAlbum, serverId: string): Album {
  return toAlbum(
    {
      ratingKey: String(al.ratingKey ?? ""),
      title: al.title ?? "",
      year: al.year,
      thumb: al.thumb,
      parentRatingKey: al.parentRatingKey !== undefined ? String(al.parentRatingKey) : undefined,
    },
    serverId,
  );
}

function toTrackSafe(t: PlexTrack, serverId: string): Track {
  return toTrack(
    {
      ratingKey: String(t.ratingKey ?? ""),
      title: t.title ?? "",
      index: t.index,
      duration: t.duration,
      parentRatingKey: t.parentRatingKey !== undefined ? String(t.parentRatingKey) : undefined,
      parentTitle: t.parentTitle,
      grandparentTitle: t.grandparentTitle,
      // MediaPart.key (from PlexObject.key) is the Plex server-relative path.
      // Media.id is number; MediaPart.id is number.
      media: t.media?.map((m) => ({
        audioCodec: m.audioCodec,
        container: undefined as string | undefined, // container is on MediaPart, not Media
        bitrate: m.bitrate,
        parts: m.parts.map((p) => ({
          id: p.id,
          key: p.key,
          container: p.container,
        })),
      })),
    },
    serverId,
  );
}
