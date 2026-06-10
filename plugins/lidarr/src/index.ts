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
 *                                             | { name: "ArtistSearch", artistId: number }
 *   (command names verified against Lidarr source: src/NzbDrone.Core/
 *   IndexerSearch/ArtistSearchCommand.cs — name = class minus "Command",
 *   ArtistSearch carries `artistId` and searches the artist's monitored albums)
 * - POST /api/v1/artist addOptions.monitor: MonitorTypes enum incl. "all";
 *   addOptions.searchForMissingAlbums: boolean (AddArtistOptions schema)
 * - GET  /api/v1/queue?includeArtist&includeAlbum → paged { records: QueueResource[] }
 * - GET  /api/v1/wanted/missing?includeArtist → paged monitored-but-missing albums
 * - GET  /api/v1/qualityprofile, /api/v1/metadataprofile, /api/v1/rootfolder
 */
import type {
  AcquirableAlbum,
  AcquisitionStatusItem,
  ExternalArtistResult,
  PluginContext,
} from "@musex/plugin-api";
import { LidarrClient, LidarrError } from "./client.js";
import { deriveAlbumState } from "./state.js";
import { createNodeTransport, fetchTransport } from "./transport.js";

/** Album metadata may not exist immediately after adding an artist (Lidarr
 *  refreshes it asynchronously, often taking 30–60s) — poll briefly inline,
 *  then defer to the background pending-albums poller instead of failing. */
const ALBUM_FIND_ATTEMPTS = 3;
const ALBUM_FIND_RETRY_MS = 2_000;
/** Background poll cadence for albums deferred until Lidarr's artist refresh
 *  produces their metadata, and how long before we give up on one. */
const PENDING_POLL_MS = 20_000;
const PENDING_MAX_AGE_MS = 15 * 60_000;
const PENDING_KEY = "pendingAlbums";
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
  /** Lookup results embed the full resource for already-added artists
   *  (id > 0); not-added results carry metadata-server defaults only. */
  monitored?: boolean;
  disambiguation?: string | null;
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
 *  needs to add the artist to Lidarr if it isn't there yet. `title` is for
 *  human-readable notifications/status (older refs may not carry it). */
type ProviderRef = {
  foreignAlbumId: string;
  foreignArtistId: string;
  artistName: string;
  title?: string;
};

/** providerRef payload for whole-ARTIST monitoring (searchArtists →
 *  acquireArtist) — opaque to the host. */
type ArtistProviderRef = {
  foreignArtistId: string;
  artistName: string;
};

/** An album whose acquisition is deferred until Lidarr's async artist refresh
 *  produces the album metadata; persisted in storage under PENDING_KEY. */
type PendingAlbum = {
  foreignArtistId: string;
  artistName: string;
  title?: string;
  addedAt: number;
};
type PendingAlbums = Record<string, PendingAlbum>;

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

// ── Ensure-artist (idempotent + race-proof) ──────────────────────────────────

type LogFn = (msg: string, ...args: unknown[]) => void;

/** Concurrent acquires for the same artist share one ensure (two quick Adds
 *  on a not-yet-added artist must not both POST /api/v1/artist). */
const ensureArtistInflight = new Map<string, Promise<LidarrArtist>>();

/** Ensure `ref`'s artist exists in Lidarr, adding it if needed. Concurrent
 *  calls for the same foreignArtistId share one in-flight ensure, and a POST
 *  that loses an add race (400 ArtistExistsValidator) resolves to the
 *  already-added artist instead of throwing. Exported for tests. */
export function ensureArtist(
  c: LidarrClient,
  ref: { foreignArtistId: string; artistName: string },
  log: LogFn,
): Promise<LidarrArtist> {
  const inflight = ensureArtistInflight.get(ref.foreignArtistId);
  if (inflight !== undefined) return inflight;
  const promise = doEnsureArtist(c, ref, log).finally(() => {
    ensureArtistInflight.delete(ref.foreignArtistId);
  });
  ensureArtistInflight.set(ref.foreignArtistId, promise);
  return promise;
}

async function doEnsureArtist(
  c: LidarrClient,
  ref: { foreignArtistId: string; artistName: string },
  log: LogFn,
): Promise<LidarrArtist> {
  const artists = await c.get<LidarrArtist[]>("/api/v1/artist");
  const existing = artists.find((a) => a.foreignArtistId === ref.foreignArtistId);
  if (existing !== undefined) return existing;
  // addOptions.monitor "none" → no albums auto-monitored; the caller (album
  // flow) monitors exactly the requested album.
  return addArtist(c, ref, { monitor: "none", searchForMissingAlbums: false }, log);
}

/** POST a new artist to Lidarr with the server's first quality/metadata
 *  profile + root folder (shared by the album flow's ensureArtist and the
 *  whole-artist acquireArtist). A POST losing an add race
 *  (400 ArtistExistsValidator) resolves to the already-added artist. */
async function addArtist(
  c: LidarrClient,
  ref: { foreignArtistId: string; artistName: string },
  addOptions: { monitor: "all" | "none"; searchForMissingAlbums: boolean },
  log: LogFn,
): Promise<LidarrArtist> {
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
  log(
    `adding artist "${ref.artistName}" with quality profile "${quality.name ?? quality.id}", ` +
      `metadata profile "${metadata.name ?? metadata.id}", root folder "${root.path}"`,
  );
  try {
    // monitored: true — the artist participates in monitoring; addOptions
    // decides which of its albums get monitored on add.
    return await c.post<LidarrArtist>("/api/v1/artist", {
      artistName: ref.artistName,
      foreignArtistId: ref.foreignArtistId,
      qualityProfileId: quality.id,
      metadataProfileId: metadata.id,
      rootFolderPath: root.path,
      monitored: true,
      addOptions,
    });
  } catch (err) {
    // Someone (another acquire, the Lidarr UI) added the artist between our
    // list fetch and the POST — treat it as success and use the existing one.
    if (err instanceof LidarrError && err.body.includes("ArtistExistsValidator")) {
      log(`artist "${ref.artistName}" was added concurrently; reusing it`);
      const refreshed = await c.get<LidarrArtist[]>("/api/v1/artist");
      const added = refreshed.find((a) => a.foreignArtistId === ref.foreignArtistId);
      if (added !== undefined) return added;
    }
    throw err;
  }
}

// ── Plugin lifecycle ─────────────────────────────────────────────────────────

/** Background poller for pending (deferred) albums; module-level so
 *  deactivate() can clear it. */
let pendingPollTimer: ReturnType<typeof setInterval> | undefined;

export function deactivate(): void {
  if (pendingPollTimer !== undefined) {
    clearInterval(pendingPollTimer);
    pendingPollTimer = undefined;
  }
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
    {
      kind: "toggle",
      key: "allowSelfSigned",
      label: "Allow self-signed certificates",
      help: "For Lidarr behind a reverse proxy with an internal/self-signed cert",
    },
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
    // Global fetch cannot relax TLS per-request; when the user opts in to
    // self-signed certs, swap in the node:https transport.
    const allowSelfSigned = (await ctx.storage.get<boolean>("allowSelfSigned")) === true;
    const httpFn = allowSelfSigned
      ? createNodeTransport({ allowSelfSigned: true })
      : fetchTransport;
    return new LidarrClient({ baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, httpFn });
  };

  // ── Pending albums (deferred until Lidarr's artist refresh finishes) ─────
  const readPending = async (): Promise<PendingAlbums> =>
    (await ctx.storage.get<PendingAlbums>(PENDING_KEY)) ?? {};

  /** Lidarr bug (Lidarr/Lidarr#3597): POST artist with addOptions.monitor
   *  "none" DISREGARDS monitored:true and adds the artist unmonitored — which
   *  silently disables RSS/upgrades for everything under it. Re-assert artist
   *  monitoring whenever we request an album. Non-fatal: the explicit
   *  AlbumSearch works either way. */
  const ensureArtistMonitored = async (
    c: LidarrClient,
    artistId: number | undefined,
  ): Promise<void> => {
    if (artistId === undefined) return;
    try {
      // PUT wants the full resource — round-trip it with only `monitored` changed.
      const artist = await c.get<Record<string, unknown>>(`/api/v1/artist/${artistId}`);
      if (artist.monitored === true) return;
      await c.put(`/api/v1/artist/${artistId}`, { ...artist, monitored: true });
      ctx.log(`re-monitored artist #${artistId} (Lidarr#3597 workaround)`);
    } catch (err) {
      ctx.log("ensureArtistMonitored failed (non-fatal):", errText(err));
    }
  };

  /** Monitor the album and kick off a search (shared by acquire + poller). */
  const requestAlbum = async (c: LidarrClient, album: LidarrAlbum): Promise<void> => {
    await ensureArtistMonitored(c, album.artistId);
    if (!album.monitored) {
      await c.put("/api/v1/album/monitor", { albumIds: [album.id], monitored: true });
    }
    await c.post("/api/v1/command", { name: "AlbumSearch", albumIds: [album.id] });
    ctx.ui.notify(`Requested ${album.title ?? "album"} on Lidarr`);
  };

  const stopPendingPoller = (): void => {
    if (pendingPollTimer !== undefined) {
      clearInterval(pendingPollTimer);
      pendingPollTimer = undefined;
    }
  };

  /** One poll pass: request every pending album whose metadata has appeared,
   *  expire entries older than PENDING_MAX_AGE_MS, stop when none remain. */
  const processPending = async (): Promise<void> => {
    const pending = await readPending();
    if (Object.keys(pending).length === 0) {
      stopPendingPoller();
      return;
    }
    // Unconfigured: skip the Lidarr calls but keep the timer armed (and let
    // age-out below still run) so entries resolve once config returns.
    const c = await client();
    let changed = false;
    for (const [foreignAlbumId, entry] of Object.entries(pending)) {
      const label = entry.title ?? "the album";
      if (Date.now() - entry.addedAt > PENDING_MAX_AGE_MS) {
        delete pending[foreignAlbumId];
        changed = true;
        ctx.ui.notify(`Couldn't request ${label} — Lidarr never produced its metadata`, "error");
        continue;
      }
      if (!c) continue;
      try {
        const albums = await c.get<LidarrAlbum[]>("/api/v1/album", { foreignAlbumId });
        const album = albums.find((a) => a.foreignAlbumId === foreignAlbumId);
        if (album === undefined) continue; // still refreshing — next pass
        await requestAlbum(c, album);
        delete pending[foreignAlbumId];
        changed = true;
      } catch (err) {
        ctx.log(`pending album poll failed for ${label}:`, errText(err));
      }
    }
    if (changed) await ctx.storage.set(PENDING_KEY, pending);
    if (Object.keys(pending).length === 0) stopPendingPoller();
  };

  const armPendingPoller = (): void => {
    if (pendingPollTimer !== undefined) return;
    pendingPollTimer = setInterval(() => {
      processPending().catch((err) => ctx.log("pending album poll pass failed:", errText(err)));
    }, PENDING_POLL_MS);
  };

  // Resume polling for any albums deferred in a previous session.
  if (Object.keys(await readPending()).length > 0) armPendingPoller();

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
        title: album.title,
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

    searchArtists: async (term) => {
      const c = await client();
      if (!c) return [];
      try {
        const results = await c.get<LidarrArtist[]>("/api/v1/artist/lookup", { term });
        const out: ExternalArtistResult[] = [];
        for (const a of results) {
          if (out.length >= 10) break;
          const name = a.artistName;
          const foreignArtistId = a.foreignArtistId;
          if (typeof name !== "string" || name.length === 0) continue;
          if (typeof foreignArtistId !== "string" || foreignArtistId.length === 0) continue;
          const ref: ArtistProviderRef = { foreignArtistId, artistName: name };
          const imageUrl = pickImageUrl(a.images);
          out.push({
            name,
            providerRef: JSON.stringify(ref),
            ...(imageUrl !== undefined ? { imageUrl } : {}),
            ...(a.disambiguation ? { disambiguation: a.disambiguation } : {}),
            // Lookup embeds the full resource for already-added artists
            // (id > 0); only those can be "monitored".
            monitored: a.id > 0 && a.monitored === true,
          });
        }
        return out;
      } catch (err) {
        ctx.log(`searchArtists failed for "${term}":`, errText(err));
        return [];
      }
    },

    acquireArtist: async (providerRef) => {
      try {
        const c = await client();
        if (!c) throw new Error("Lidarr is not configured");
        let ref: ArtistProviderRef;
        try {
          ref = JSON.parse(providerRef) as ArtistProviderRef;
        } catch {
          throw new Error("Invalid acquisition reference");
        }
        if (!ref.foreignArtistId || !ref.artistName) {
          throw new Error("Invalid acquisition reference");
        }

        const artists = await c.get<LidarrArtist[]>("/api/v1/artist");
        const existing = artists.find((a) => a.foreignArtistId === ref.foreignArtistId);

        if (existing === undefined) {
          // Not in Lidarr yet: one POST does it all — monitor "all" + search.
          const added = await addArtist(
            c,
            ref,
            { monitor: "all", searchForMissingAlbums: true },
            ctx.log,
          );
          // Lidarr#3597: addOptions.monitor can disregard the monitored flag —
          // assert the artist ended up monitored.
          await ensureArtistMonitored(c, added.id);
        } else {
          // Already in Lidarr (e.g. added unmonitored by the album flow):
          // monitor the artist + ALL its albums, then an artist-wide search.
          await ensureArtistMonitored(c, existing.id);
          const albums = await c.get<LidarrAlbum[]>("/api/v1/album", {
            artistId: String(existing.id),
          });
          const albumIds = albums.map((a) => a.id);
          if (albumIds.length > 0) {
            await c.put("/api/v1/album/monitor", { albumIds, monitored: true });
          }
          await c.post("/api/v1/command", { name: "ArtistSearch", artistId: existing.id });
        }
        ctx.ui.notify(`Monitoring everything by ${ref.artistName} on Lidarr`);
      } catch (err) {
        ctx.log("acquireArtist failed:", errText(err));
        throw err;
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

        // 1. Ensure the artist exists in Lidarr (deduped + race-proof).
        await ensureArtist(c, ref, ctx.log);

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
          // Lidarr's artist refresh (often 30–60s) hasn't produced the album
          // yet — defer to the background poller instead of failing; the
          // artist add itself succeeded.
          const pending = await readPending();
          pending[ref.foreignAlbumId] = {
            foreignArtistId: ref.foreignArtistId,
            artistName: ref.artistName,
            ...(ref.title !== undefined ? { title: ref.title } : {}),
            addedAt: Date.now(),
          };
          await ctx.storage.set(PENDING_KEY, pending);
          armPendingPoller();
          ctx.ui.notify(
            `Artist added — ${ref.title ?? "the album"} will be requested when Lidarr finishes fetching metadata`,
          );
          return;
        }

        // 3. Monitor it and kick off a search.
        await requestAlbum(c, album);
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

        // Albums deferred until Lidarr's artist refresh produces metadata —
        // not in Lidarr's queue/wanted yet, so list them first.
        for (const entry of Object.values(await readPending())) {
          items.push({
            title: entry.title ?? "(album)",
            artistName: entry.artistName,
            state: "requested",
            detail: "waiting for Lidarr metadata",
          });
        }

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
