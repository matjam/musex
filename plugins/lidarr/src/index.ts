/**
 * @musex/plugin-lidarr — album acquisition via a Lidarr server.
 *
 * Runs full-trust in the Electron main process; codes purely against the
 * @musex/plugin-api types (compile-time only). Never imports electron or any
 * @musex runtime code.
 *
 * API surface verified against the Lidarr OpenAPI spec
 * (Lidarr/Lidarr src/Lidarr.Api.V1/openapi.json, 2026-06-09):
 * - GET  /api/v1/system/status                → { version }
 * - GET  /api/v1/artist/lookup?term=          → ArtistResource[] (id > 0 when already added)
 * - GET  /api/v1/artist                       → added artists
 * - POST /api/v1/artist                       → required: artistName, foreignArtistId,
 *        qualityProfileId, metadataProfileId, rootFolderPath (validators in ArtistController)
 * - GET  /api/v1/album?artistId= | ?foreignAlbumId=  → AlbumResource[] (empty list on no match)
 * - GET  /api/v1/album/lookup?term=           → metadata search; AlbumResource embeds artist
 * - PUT  /api/v1/album/monitor                → { albumIds, monitored } (202 Accepted)
 * - POST /api/v1/command                      → { name: "AlbumSearch", albumIds: number[] }
 * - GET  /api/v1/queue?includeArtist&includeAlbum → paged { records: QueueResource[] }
 * - GET  /api/v1/wanted/missing?includeArtist → paged monitored-but-missing albums
 * - GET  /api/v1/qualityprofile, /api/v1/metadataprofile, /api/v1/rootfolder
 */
import type { AcquirableAlbum, AcquisitionStatusItem, PluginContext } from "@musex/plugin-api";
import { LidarrClient } from "./client.js";
import { deriveAlbumState } from "./state.js";

/** Album metadata may not exist immediately after adding an artist (Lidarr
 *  refreshes it asynchronously) — poll a few times before giving up. */
const ALBUM_FIND_ATTEMPTS = 5;
const ALBUM_FIND_RETRY_MS = 2_000;
/** Queue page size for lookup/status (Lidarr defaults to 10). */
const QUEUE_PAGE_SIZE = 100;
/** Downloads view cap. */
const STATUS_MAX_ITEMS = 50;

// ── Lidarr resource shapes (narrowed to the fields we read) ─────────────────

type LidarrImage = { coverType?: string | null; url?: string | null; remoteUrl?: string | null };

type LidarrArtist = {
  id: number;
  artistName?: string | null;
  foreignArtistId?: string | null;
  images?: LidarrImage[] | null;
};

type LidarrAlbum = {
  id: number;
  title?: string | null;
  foreignAlbumId?: string | null;
  artistId?: number;
  monitored: boolean;
  releaseDate?: string | null;
  images?: LidarrImage[] | null;
  statistics?: { trackFileCount: number; totalTrackCount: number } | null;
  /** Embedded by album/lookup and by paged endpoints with includeArtist. */
  artist?: LidarrArtist | null;
};

type LidarrQueueRecord = {
  id: number;
  albumId?: number | null;
  album?: LidarrAlbum | null;
  artist?: LidarrArtist | null;
  title?: string | null;
  status?: string | null;
  trackedDownloadState?: string | null;
  size: number;
  sizeleft: number;
};

type LidarrPage<T> = { records?: T[] | null };
type LidarrSystemStatus = { version?: string | null };
type LidarrProfile = { id: number; name?: string | null };
type LidarrRootFolder = { id: number; path?: string | null };

/** providerRef payload — opaque to the host; carries everything acquireAlbum
 *  needs to add the artist to Lidarr if it isn't there yet. */
type ProviderRef = { foreignAlbumId: string; foreignArtistId: string; artistName: string };

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Best remote image URL: prefer the "cover"/"poster" type, else the first
 *  with a remoteUrl. Local `url`s need the Lidarr API key, so only remoteUrl
 *  (the metadata server's URL) is usable by the renderer. */
function pickImageUrl(images: LidarrImage[] | null | undefined): string | undefined {
  const usable = (Array.isArray(images) ? images : []).filter(
    (i): i is LidarrImage & { remoteUrl: string } =>
      typeof i.remoteUrl === "string" && i.remoteUrl.length > 0,
  );
  const byType = (t: string) => usable.find((i) => i.coverType === t)?.remoteUrl;
  return byType("cover") ?? byType("poster") ?? usable[0]?.remoteUrl;
}

function yearOf(releaseDate: string | null | undefined): number | undefined {
  if (typeof releaseDate !== "string") return undefined;
  const y = Number(releaseDate.slice(0, 4));
  return Number.isInteger(y) && y > 0 ? y : undefined;
}

/** 0..1 from a queue record; undefined when the size is unknown. */
function queueProgress(rec: LidarrQueueRecord): number | undefined {
  if (!(rec.size > 0) || !(rec.sizeleft >= 0)) return undefined;
  return Math.min(1, Math.max(0, 1 - rec.sizeleft / rec.size));
}

export async function activate(ctx: PluginContext): Promise<void> {
  ctx.registerSettings([
    {
      kind: "text",
      key: "baseUrl",
      label: "Server URL",
      help: "e.g. http://192.168.1.5:8686",
    },
    { kind: "password", key: "apiKey", label: "API key" },
    { kind: "action", key: "test", label: "Test connection" },
    { kind: "status", key: "connection" },
  ]);

  if ((await ctx.storage.get<string>("connection")) === null) {
    await ctx.storage.set("connection", "Not connected");
  }

  const configured = async (): Promise<{ baseUrl: string; apiKey: string } | null> => {
    const baseUrl = await ctx.storage.get<string>("baseUrl");
    const apiKey = await ctx.secrets.get("apiKey");
    if (!baseUrl || !apiKey) return null;
    return { baseUrl, apiKey };
  };

  const client = async (): Promise<LidarrClient | null> => {
    const cfg = await configured();
    if (!cfg) return null;
    return new LidarrClient({ baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, fetchFn: ctx.fetch });
  };

  // ── Test connection ─────────────────────────────────────────────────────
  ctx.onSettingsAction("test", async () => {
    const c = await client();
    if (!c) return { ok: false, message: "Enter the server URL and API key first" };
    try {
      const status = await c.get<LidarrSystemStatus>("/api/v1/system/status");
      const message = `Connected — Lidarr ${status.version ?? "(unknown version)"}`;
      await ctx.storage.set("connection", message);
      return { ok: true, message };
    } catch (err) {
      await ctx.storage.set("connection", "Connection failed");
      return { ok: false, message: `Connection failed: ${errText(err)}` };
    }
  });

  // ── Queue helpers ────────────────────────────────────────────────────────
  const fetchQueue = async (c: LidarrClient, embed: boolean): Promise<LidarrQueueRecord[]> => {
    const page = await c.get<LidarrPage<LidarrQueueRecord>>("/api/v1/queue", {
      page: "1",
      pageSize: String(QUEUE_PAGE_SIZE),
      ...(embed ? { includeArtist: "true", includeAlbum: "true" } : {}),
    });
    return Array.isArray(page.records) ? page.records : [];
  };

  /** Map an album list (added artist) + queue → AcquirableAlbum[]. */
  const toAcquirable = (
    albums: LidarrAlbum[],
    queue: LidarrQueueRecord[],
    fallback: { artistName: string; foreignArtistId: string; imageUrl?: string },
  ): AcquirableAlbum[] => {
    const queueByAlbum = new Map<number, LidarrQueueRecord>();
    for (const rec of queue) {
      if (typeof rec.albumId === "number") queueByAlbum.set(rec.albumId, rec);
    }
    const out: AcquirableAlbum[] = [];
    for (const album of albums) {
      if (typeof album.foreignAlbumId !== "string" || album.foreignAlbumId.length === 0) continue;
      if (typeof album.title !== "string" || album.title.length === 0) continue;
      const rec = queueByAlbum.get(album.id);
      const derived = deriveAlbumState(album, rec !== undefined);
      let detail = derived.detail;
      if (derived.state === "downloading" && rec !== undefined) {
        const progress = queueProgress(rec);
        if (progress !== undefined) detail = `${Math.round(progress * 100)}%`;
      }
      const year = yearOf(album.releaseDate);
      const imageUrl = pickImageUrl(album.images) ?? fallback.imageUrl;
      const ref: ProviderRef = {
        foreignAlbumId: album.foreignAlbumId,
        foreignArtistId: fallback.foreignArtistId,
        artistName: fallback.artistName,
      };
      out.push({
        title: album.title,
        artistName: fallback.artistName,
        ...(year !== undefined ? { year } : {}),
        ...(imageUrl !== undefined ? { imageUrl } : {}),
        providerRef: JSON.stringify(ref),
        state: derived.state,
        ...(detail !== undefined ? { detail } : {}),
      });
    }
    return out;
  };

  // ── Acquisition provider ─────────────────────────────────────────────────
  ctx.registerAcquisitionProvider({
    id: "lidarr",

    lookupArtistAlbums: async (artistName) => {
      const c = await client();
      if (!c) return [];
      try {
        const results = await c.get<LidarrArtist[]>("/api/v1/artist/lookup", {
          term: artistName,
        });
        const lower = artistName.toLowerCase();
        const match = results.find((a) => a.artistName?.toLowerCase() === lower) ?? results[0];
        const foreignArtistId = match?.foreignArtistId;
        if (
          match === undefined ||
          typeof foreignArtistId !== "string" ||
          foreignArtistId.length === 0
        ) {
          return []; // artist unknown to Lidarr's metadata server
        }
        const matchedName = match.artistName ?? artistName;
        const artistImage = pickImageUrl(match.images);
        const fallback = {
          artistName: matchedName,
          foreignArtistId,
          ...(artistImage !== undefined ? { imageUrl: artistImage } : {}),
        };

        if (match.id > 0) {
          // Artist is in Lidarr: full discography + live queue state.
          const [albums, queue] = await Promise.all([
            c.get<LidarrAlbum[]>("/api/v1/album", { artistId: String(match.id) }),
            fetchQueue(c, false),
          ]);
          return toAcquirable(albums, queue, fallback);
        }

        // Artist NOT added: Lidarr can't enumerate a full discography without
        // adding the artist, but the metadata search (album/lookup) returns
        // albums with the owning artist embedded — filter to this artist.
        // Search results are not in Lidarr's DB (id 0, unmonitored, no stats)
        // so they all derive to "available".
        const found = await c.get<LidarrAlbum[]>("/api/v1/album/lookup", { term: artistName });
        const albums = found.filter((al) => al.artist?.foreignArtistId === foreignArtistId);
        return toAcquirable(albums, [], fallback);
      } catch (err) {
        ctx.log(`lookupArtistAlbums failed for "${artistName}":`, errText(err));
        return [];
      }
    },

    acquireAlbum: async (providerRef) => {
      try {
        const c = await client();
        if (!c) throw new Error("Lidarr is not configured");
        let ref: ProviderRef;
        try {
          ref = JSON.parse(providerRef) as ProviderRef;
        } catch {
          throw new Error("Invalid acquisition reference");
        }
        if (!ref.foreignAlbumId || !ref.foreignArtistId || !ref.artistName) {
          throw new Error("Invalid acquisition reference");
        }

        // 1. Ensure the artist exists in Lidarr.
        const artists = await c.get<LidarrArtist[]>("/api/v1/artist");
        let artist = artists.find((a) => a.foreignArtistId === ref.foreignArtistId);
        if (artist === undefined) {
          const [qualityProfiles, metadataProfiles, rootFolders] = await Promise.all([
            c.get<LidarrProfile[]>("/api/v1/qualityprofile"),
            c.get<LidarrProfile[]>("/api/v1/metadataprofile"),
            c.get<LidarrRootFolder[]>("/api/v1/rootfolder"),
          ]);
          const quality = qualityProfiles[0];
          const metadata = metadataProfiles[0];
          const root = rootFolders[0];
          if (quality === undefined) {
            throw new Error("Lidarr has no quality profiles — create one in Lidarr first");
          }
          if (metadata === undefined) {
            throw new Error("Lidarr has no metadata profiles — create one in Lidarr first");
          }
          if (root === undefined || !root.path) {
            throw new Error("Lidarr has no root folders — add one in Lidarr first");
          }
          ctx.log(
            `adding artist "${ref.artistName}" with quality profile "${quality.name ?? quality.id}", ` +
              `metadata profile "${metadata.name ?? metadata.id}", root folder "${root.path}"`,
          );
          // monitored: true (the artist participates in monitoring) but
          // addOptions.monitor "none" → no albums auto-monitored; we monitor
          // exactly the requested album below.
          artist = await c.post<LidarrArtist>("/api/v1/artist", {
            artistName: ref.artistName,
            foreignArtistId: ref.foreignArtistId,
            qualityProfileId: quality.id,
            metadataProfileId: metadata.id,
            rootFolderPath: root.path,
            monitored: true,
            addOptions: { monitor: "none", searchForMissingAlbums: false },
          });
        }

        // 2. Find the album. After a fresh artist add, Lidarr populates album
        // metadata asynchronously — retry briefly.
        let album: LidarrAlbum | undefined;
        for (let attempt = 0; attempt < ALBUM_FIND_ATTEMPTS; attempt++) {
          if (attempt > 0) await sleep(ALBUM_FIND_RETRY_MS);
          const albums = await c.get<LidarrAlbum[]>("/api/v1/album", {
            foreignAlbumId: ref.foreignAlbumId,
          });
          album = albums.find((a) => a.foreignAlbumId === ref.foreignAlbumId);
          if (album !== undefined) break;
        }
        if (album === undefined) {
          throw new Error(
            "Album metadata is not in Lidarr yet — it may still be refreshing; try again shortly",
          );
        }

        // 3. Monitor it and kick off a search.
        if (!album.monitored) {
          await c.put("/api/v1/album/monitor", { albumIds: [album.id], monitored: true });
        }
        await c.post("/api/v1/command", { name: "AlbumSearch", albumIds: [album.id] });
        ctx.ui.notify(`Requested ${album.title ?? "album"} on Lidarr`);
      } catch (err) {
        ctx.log("acquireAlbum failed:", errText(err));
        throw err;
      }
    },

    status: async () => {
      const c = await client();
      if (!c) return [];
      try {
        const items: AcquisitionStatusItem[] = [];
        const queuedAlbumIds = new Set<number>();

        // Active downloads (queue embeds artist/album with the include flags).
        const queue = await fetchQueue(c, true);
        for (const rec of queue) {
          if (typeof rec.albumId === "number") queuedAlbumIds.add(rec.albumId);
          const title = rec.album?.title ?? rec.title ?? "Unknown album";
          const artistName =
            rec.artist?.artistName ?? rec.album?.artist?.artistName ?? "Unknown artist";
          const progress = queueProgress(rec);
          const detail = rec.trackedDownloadState ?? rec.status ?? undefined;
          items.push({
            title,
            artistName,
            state: "downloading",
            ...(progress !== undefined ? { progress } : {}),
            ...(detail !== undefined && detail !== null ? { detail } : {}),
          });
        }

        // Monitored albums still missing tracks (and not actively downloading).
        const missing = await c.get<LidarrPage<LidarrAlbum>>("/api/v1/wanted/missing", {
          page: "1",
          pageSize: String(STATUS_MAX_ITEMS),
          includeArtist: "true",
          monitored: "true",
        });
        for (const album of Array.isArray(missing.records) ? missing.records : []) {
          if (items.length >= STATUS_MAX_ITEMS) break;
          if (queuedAlbumIds.has(album.id)) continue;
          const stats = album.statistics;
          const detail =
            stats !== undefined && stats !== null && stats.trackFileCount > 0
              ? `${stats.trackFileCount}/${stats.totalTrackCount} tracks`
              : undefined;
          items.push({
            title: album.title ?? "Unknown album",
            artistName: album.artist?.artistName ?? "Unknown artist",
            state: "requested",
            ...(detail !== undefined ? { detail } : {}),
          });
        }

        return items.slice(0, STATUS_MAX_ITEMS);
      } catch (err) {
        ctx.log("status failed:", errText(err));
        return [];
      }
    },
  });
}
