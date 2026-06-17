/**
 * LastfmService — first-party Last.fm provider baked into core.
 *
 * Ports the logic from the old @musex/plugin-lastfm activate() function.
 * Registers on the ProviderHub in-process (no plugin sandbox, no dynamic import).
 * Uses globalThis.fetch directly (running in Electron main, fetch is available).
 */

import type {
  Disposable,
  PluginEvents,
  RecommendedTrack,
  Section,
  SimilarItem,
} from "@musex/plugin-api";
import type { ProviderHub } from "../providers/provider-hub.js";
import { isLastfmError, LastfmClient } from "./client.js";

const AUTH_URL = "https://www.last.fm/api/auth/";
const AUTH_POLL_INTERVAL_MS = 5_000;
const AUTH_POLL_TIMEOUT_MS = 120_000;
/** Discover: seed sections from this many recent artists, N similar each. */
const SIMILAR_SEED_ARTISTS = 3;
const SIMILAR_LIMIT = 10;
const TOP_TAGS = 3;
/** Similar side panel: items per artist.getSimilar / track.getSimilar call. */
const SIMILAR_PANEL_LIMIT = 18;
/** Radio: similar tracks per seed track / similar artists for the seed artist. */
const RADIO_SEED_TRACKS = 3;
const RADIO_SIMILAR_TRACKS_LIMIT = 10;
const RADIO_SIMILAR_ARTISTS_LIMIT = 5;
/** Discover artwork cache key and settings. */
const ART_CACHE_KEY = "artistArt";
const ART_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const ART_CACHE_MAX_ENTRIES = 500;
/** last.fm's "no image" placeholder — every URL containing this hash is the
 *  same grey star; treat it as no artwork. */
const ART_PLACEHOLDER_HASH = "2a96cbd8b46e442fc41c2b86b821562f";

type TokenResponse = { token: string };
type SessionResponse = { session: { name: string; key: string } };
type SimilarResponse = {
  similarartists?: { artist?: { name: string; url?: string; match?: string }[] };
};
type SimilarTracksResponse = {
  similartracks?: {
    track?: { name: string; url?: string; artist?: { name?: string }; image?: LastfmImage[] }[];
  };
};
type LastfmImage = { size?: string; ["#text"]?: string };
type TopAlbumsResponse = {
  topalbums?: { album?: { name?: string; image?: LastfmImage[] }[] };
};
/** url: null = known-miss (artist has no usable cover) — cached to avoid
 *  re-querying; entries expire after ART_TTL_MS. */
type ArtistArtCache = Record<string, { url: string | null; fetchedAt: number }>;

type TrackInfoResponse = {
  track?: {
    playcount?: string;
    listeners?: string;
    userplaycount?: string;
    toptags?: { tag?: { name?: string }[] };
  };
};

interface ArtistInfoResponse {
  artist?: {
    name?: string;
    url?: string;
    image?: Array<{ size?: string; "#text"?: string }>;
    stats?: { listeners?: string; playcount?: string };
    bio?: { summary?: string };
  };
}

/** last.fm returns counts as decimal strings; render with locale separators. */
function count(v: string): string {
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString() : v;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** artist/track/album?/duration? params shared by updateNowPlaying + scrobble. */
function trackParams(t: {
  artistName: string;
  title: string;
  albumTitle?: string;
  durationMs: number;
}): Record<string, string> {
  return {
    artist: t.artistName,
    track: t.title,
    ...(t.albumTitle !== undefined ? { album: t.albumTitle } : {}),
    ...(t.durationMs > 0 ? { duration: String(Math.round(t.durationMs / 1000)) } : {}),
  };
}

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Best cover URL from a last.fm image array: extralarge → large → last
 *  non-empty. The dead placeholder image counts as no artwork. */
function pickImageUrl(images: LastfmImage[] | undefined): string | null {
  const usable = (Array.isArray(images) ? images : []).filter(
    (i): i is LastfmImage & { ["#text"]: string } =>
      typeof i["#text"] === "string" &&
      i["#text"].length > 0 &&
      !i["#text"].includes(ART_PLACEHOLDER_HASH),
  );
  const bySize = (size: string) => usable.find((i) => i.size === size)?.["#text"];
  return bySize("extralarge") ?? bySize("large") ?? usable[usable.length - 1]?.["#text"] ?? null;
}

export interface LastfmConfig {
  apiKey: string;
  apiSecret: string;
  sessionKey: string | null;
  username: string | null;
  scrobbling: boolean;
  loveOnRating: boolean;
  connection: string;
}

export interface LastfmServiceDeps {
  /** Read the current config (may be called multiple times). */
  getConfig(): Promise<LastfmConfig>;
  /** Persist a config update (partial — only changed fields are written). */
  setConfig(patch: Partial<LastfmConfig>): Promise<void>;
  /** Open a URL in the system browser (http/https only). */
  openExternal(url: string): void;
  /** Show a toast notification. */
  notify(message: string, level?: "info" | "error"): void;
  /** Log to the unified log buffer. */
  log(...args: string[]): void;
  /** Persisted JSON storage keyed by string (like plugin ctx.storage). */
  storageGet<T>(key: string): Promise<T | null>;
  storageSet(key: string, value: unknown): Promise<void>;
}

export class LastfmService {
  private disposables: Disposable[] = [];

  /** Start registering providers on the hub and subscribing to events.
   *  Returns a Disposable that tears everything down. */
  start(hub: ProviderHub, deps: LastfmServiceDeps): Disposable {
    const PROVIDER_ID = "core:lastfm";
    const fetchFn = globalThis.fetch.bind(globalThis);

    // ── Credential helpers ──────────────────────────────────────────────────

    const credentials = async (): Promise<{ apiKey: string; secret: string } | null> => {
      const cfg = await deps.getConfig();
      if (!cfg.apiKey || !cfg.apiSecret) return null;
      return { apiKey: cfg.apiKey, secret: cfg.apiSecret };
    };

    const client = async (): Promise<LastfmClient | null> => {
      const creds = await credentials();
      if (!creds) return null;
      return new LastfmClient({ apiKey: creds.apiKey, secret: creds.secret, fetchFn });
    };

    const session = async (): Promise<{ client: LastfmClient; sk: string } | null> => {
      const c = await client();
      if (!c) return null;
      const cfg = await deps.getConfig();
      const sk = cfg.sessionKey;
      if (!sk) return null;
      return { client: c, sk };
    };

    // ── Connect (desktop auth flow) ──────────────────────────────────────────

    /** Start the OAuth-like desktop auth flow. Called from IPC. */
    const connect = async (): Promise<{ ok: boolean; message: string }> => {
      const creds = await credentials();
      if (!creds) return { ok: false, message: "Enter API key and shared secret first" };
      const c = new LastfmClient({ apiKey: creds.apiKey, secret: creds.secret, fetchFn });
      const { token } = await c.call<TokenResponse>("auth.getToken", {});
      deps.openExternal(
        `${AUTH_URL}?api_key=${encodeURIComponent(creds.apiKey)}&token=${encodeURIComponent(token)}`,
      );
      const deadline = Date.now() + AUTH_POLL_TIMEOUT_MS;
      while (Date.now() < deadline) {
        await sleep(AUTH_POLL_INTERVAL_MS);
        let res: SessionResponse;
        try {
          res = await c.call<SessionResponse>("auth.getSession", { token });
        } catch (err) {
          if (isLastfmError(err, 14)) continue;
          throw err;
        }
        await deps.setConfig({
          sessionKey: res.session.key,
          username: res.session.name,
          connection: `Connected as ${res.session.name}`,
        });
        deps.notify(`Connected to Last.fm as ${res.session.name}`);
        return { ok: true, message: `Connected as ${res.session.name}` };
      }
      return { ok: false, message: "Authorization not completed — try again" };
    };

    // Store the connect function so IPC can call it.
    this.connect = connect;

    // ── Artwork cache helper ─────────────────────────────────────────────────

    const applyArtistArt = async (
      c: LastfmClient,
      items: { name: string; imageUrl?: string }[],
    ): Promise<void> => {
      const names = [...new Set(items.map((i) => i.name))];
      if (names.length === 0) return;
      const cache = (await deps.storageGet<ArtistArtCache>(ART_CACHE_KEY)) ?? {};
      const now = Date.now();
      const stale = names.filter((n) => {
        const entry = cache[n.toLowerCase()];
        return !entry || now - entry.fetchedAt >= ART_TTL_MS;
      });
      await Promise.all(
        stale.map(async (artist) => {
          try {
            const res = await c.call<TopAlbumsResponse>(
              "artist.getTopAlbums",
              { artist, limit: "1", autocorrect: "1" },
              { signed: false },
            );
            cache[artist.toLowerCase()] = {
              url: pickImageUrl(res.topalbums?.album?.[0]?.image),
              fetchedAt: now,
            };
          } catch (err) {
            deps.log(`artist.getTopAlbums failed for "${artist}":`, errText(err));
          }
        }),
      );
      if (stale.length > 0) {
        let entries = Object.entries(cache);
        if (entries.length > ART_CACHE_MAX_ENTRIES) {
          entries = entries
            .sort((a, b) => b[1].fetchedAt - a[1].fetchedAt)
            .slice(0, ART_CACHE_MAX_ENTRIES);
        }
        await deps.storageSet(ART_CACHE_KEY, Object.fromEntries(entries));
      }
      for (const item of items) {
        const url = cache[item.name.toLowerCase()]?.url;
        if (url) item.imageUrl = url;
      }
    };

    // ── Fetch similar artists ────────────────────────────────────────────────

    const fetchSimilarArtists = async (
      c: LastfmClient,
      artistName: string,
      limit: number,
    ): Promise<SimilarItem[]> => {
      const res = await c.call<SimilarResponse>(
        "artist.getSimilar",
        { artist: artistName, limit: String(limit), autocorrect: "1" },
        { signed: false },
      );
      const raw = res.similarartists?.artist;
      return (Array.isArray(raw) ? raw : [])
        .filter((a) => typeof a.name === "string" && a.name.length > 0)
        .map((a) => {
          const match = a.match !== undefined ? Number(a.match) : Number.NaN;
          return {
            name: a.name,
            ...(typeof a.url === "string" ? { externalUrl: a.url } : {}),
            ...(Number.isFinite(match) ? { match } : {}),
          };
        });
    };

    // ── Register: similar provider ───────────────────────────────────────────

    this.disposables.push(
      hub.registerSimilarProvider(PROVIDER_ID, {
        id: "lastfm-similar",
        topAlbums: async (artistName) => {
          const s = await session();
          if (!s) return [];
          try {
            const res = await s.client.call<TopAlbumsResponse>(
              "artist.getTopAlbums",
              { artist: artistName, limit: "10", autocorrect: "1" },
              { signed: false },
            );
            const raw = res.topalbums?.album;
            return (Array.isArray(raw) ? raw : []).flatMap((a) =>
              typeof a.name === "string" && a.name.length > 0 ? [{ title: a.name }] : [],
            );
          } catch (err) {
            deps.log(`artist.getTopAlbums failed for "${artistName}":`, errText(err));
            return [];
          }
        },
        similarArtists: async (artistName) => {
          const s = await session();
          if (!s) return [];
          try {
            const items = await fetchSimilarArtists(s.client, artistName, SIMILAR_PANEL_LIMIT);
            try {
              await applyArtistArt(s.client, items);
            } catch (err) {
              deps.log("artist artwork lookup failed:", errText(err));
            }
            return items;
          } catch (err) {
            deps.log(`artist.getSimilar failed for "${artistName}":`, errText(err));
            return [];
          }
        },
        artistInfo: async (artistName) => {
          const s = await session();
          if (!s) return null;
          try {
            const res = await s.client.call<ArtistInfoResponse>(
              "artist.getInfo",
              { artist: artistName, autocorrect: "1" },
              { signed: false },
            );
            const a = res.artist;
            if (!a || typeof a.name !== "string") return null;
            const bio = a.bio?.summary
              ?.replace(/<a [^>]*>.*?<\/a>/gs, "")
              .replace(/<[^>]+>/g, "")
              .trim();
            const image = (Array.isArray(a.image) ? a.image : []).find(
              (i) => i.size === "extralarge" && i["#text"],
            );
            const listeners = Number(a.stats?.listeners);
            const playCount = Number(a.stats?.playcount);
            return {
              name: a.name,
              bio: bio || undefined,
              url: typeof a.url === "string" ? a.url : undefined,
              listeners: Number.isFinite(listeners) ? listeners : undefined,
              playCount: Number.isFinite(playCount) ? playCount : undefined,
              imageUrl: image?.["#text"],
            };
          } catch (err) {
            deps.log(`artist.getInfo failed for "${artistName}":`, errText(err));
            return null;
          }
        },
        similarTracks: async ({ title, artist }) => {
          const s = await session();
          if (!s) return [];
          try {
            const res = await s.client.call<SimilarTracksResponse>(
              "track.getSimilar",
              { artist, track: title, limit: String(SIMILAR_PANEL_LIMIT), autocorrect: "1" },
              { signed: false },
            );
            const raw = res.similartracks?.track;
            const items: SimilarItem[] = [];
            for (const t of Array.isArray(raw) ? raw : []) {
              const artistName = t.artist?.name;
              if (typeof t.name !== "string" || t.name.length === 0) continue;
              if (typeof artistName !== "string" || artistName.length === 0) continue;
              const imageUrl = pickImageUrl(t.image);
              items.push({
                name: t.name,
                artistName,
                ...(imageUrl !== null ? { imageUrl } : {}),
                ...(typeof t.url === "string" ? { externalUrl: t.url } : {}),
              });
            }
            return items;
          } catch (err) {
            deps.log(`track.getSimilar failed for "${artist} – ${title}":`, errText(err));
            return [];
          }
        },
      }),
    );

    // ── Register: track recommender (radio) ──────────────────────────────────

    this.disposables.push(
      hub.registerTrackRecommender(PROVIDER_ID, {
        id: "lastfm-similar-tracks",
        recommend: async (rctx) => {
          const s = await session();
          if (!s) return [];
          const out: RecommendedTrack[] = [];
          for (const seed of rctx.seedTracks.slice(0, RADIO_SEED_TRACKS)) {
            try {
              const res = await s.client.call<SimilarTracksResponse>(
                "track.getSimilar",
                {
                  artist: seed.artist,
                  track: seed.title,
                  limit: String(RADIO_SIMILAR_TRACKS_LIMIT),
                  autocorrect: "1",
                },
                { signed: false },
              );
              const raw = res.similartracks?.track;
              for (const t of Array.isArray(raw) ? raw : []) {
                const artistName = t.artist?.name;
                if (
                  typeof t.name === "string" &&
                  t.name.length > 0 &&
                  typeof artistName === "string" &&
                  artistName.length > 0
                ) {
                  out.push({ artistName, title: t.name });
                }
              }
            } catch (err) {
              deps.log(
                `track.getSimilar failed for "${seed.artist} – ${seed.title}":`,
                errText(err),
              );
            }
          }
          const seedArtist = rctx.seedArtists[0];
          if (seedArtist !== undefined) {
            try {
              const res = await s.client.call<SimilarResponse>(
                "artist.getSimilar",
                {
                  artist: seedArtist,
                  limit: String(RADIO_SIMILAR_ARTISTS_LIMIT),
                  autocorrect: "1",
                },
                { signed: false },
              );
              const raw = res.similarartists?.artist;
              for (const a of Array.isArray(raw) ? raw : []) {
                if (typeof a.name === "string" && a.name.length > 0) {
                  out.push({ artistName: a.name });
                }
              }
            } catch (err) {
              deps.log(`artist.getSimilar failed for "${seedArtist}":`, errText(err));
            }
          }
          return out;
        },
      }),
    );

    // ── Register: discover sections ──────────────────────────────────────────

    this.disposables.push(
      hub.contributeSections(PROVIDER_ID, "discover", {
        id: "lastfm-similar",
        getSections: async (sectionCtx) => {
          const s = await session();
          if (!s) return [];
          const sections: Section[] = [];
          const seeds =
            sectionCtx.topArtists.length > 0
              ? sectionCtx.topArtists.map((a) => a.name)
              : sectionCtx.recentArtists;
          for (const artistName of seeds.slice(0, SIMILAR_SEED_ARTISTS)) {
            try {
              const items = await fetchSimilarArtists(s.client, artistName, SIMILAR_LIMIT);
              if (items.length > 0) {
                sections.push({ title: `Because you listened to ${artistName}`, items });
              }
            } catch (err) {
              deps.log(`artist.getSimilar failed for "${artistName}":`, errText(err));
            }
          }
          try {
            await applyArtistArt(
              s.client,
              sections.flatMap((sec) => sec.items),
            );
          } catch (err) {
            deps.log("artist artwork lookup failed:", errText(err));
          }
          return sections;
        },
      }),
    );

    // ── Register: track detail provider ─────────────────────────────────────

    this.disposables.push(
      hub.contributeTrackDetail(PROVIDER_ID, {
        id: "lastfm-info",
        getDetail: async (track) => {
          const c = await client();
          if (!c) return null;
          const cfg = await deps.getConfig();
          const username = cfg.username;
          try {
            const res = await c.call<TrackInfoResponse>(
              "track.getInfo",
              {
                artist: track.artistName,
                track: track.title,
                autocorrect: "1",
                ...(username ? { username } : {}),
              },
              { signed: false },
            );
            const t = res.track;
            if (!t) return null;
            const rows: { label: string; value: string }[] = [];
            if (t.playcount !== undefined)
              rows.push({ label: "Scrobbles", value: count(t.playcount) });
            if (t.listeners !== undefined)
              rows.push({ label: "Listeners", value: count(t.listeners) });
            if (t.userplaycount !== undefined) {
              rows.push({ label: "Your scrobbles", value: count(t.userplaycount) });
            }
            const rawTags = t.toptags?.tag;
            const tags = (Array.isArray(rawTags) ? rawTags : [])
              .map((x) => x.name)
              .filter((n): n is string => typeof n === "string" && n.length > 0)
              .slice(0, TOP_TAGS);
            if (tags.length > 0) rows.push({ label: "Tags", value: tags.join(", ") });
            if (rows.length === 0) return null;
            return { title: "Last.fm", rows };
          } catch (err) {
            deps.log("track.getInfo failed:", errText(err));
            return null;
          }
        },
      }),
    );

    // ── Register: "Love on Last.fm" track action ─────────────────────────────

    this.disposables.push(
      hub.contributeTrackAction(PROVIDER_ID, {
        id: "lastfm-love",
        label: "Love on Last.fm",
        icon: "heart",
        onInvoke: async (track) => {
          const s = await session();
          if (!s) {
            deps.notify("Connect your Last.fm account first (Settings → Last.fm)", "error");
            return;
          }
          try {
            await s.client.call(
              "track.love",
              { artist: track.artistName, track: track.title },
              { sk: s.sk },
            );
            deps.notify(`Loved "${track.title}" on Last.fm`);
          } catch (err) {
            deps.notify(`Last.fm love failed: ${errText(err)}`, "error");
          }
        },
      }),
    );

    // ── Event subscriptions ───────────────────────────────────────────────────

    this.disposables.push(
      hub.onEvent(PROVIDER_ID, "trackStarted", (payload) => {
        void (async () => {
          const s = await session();
          if (!s) return;
          const cfg = await deps.getConfig();
          if (!cfg.scrobbling) return;
          await s.client
            .call("track.updateNowPlaying", trackParams(payload.track), { sk: s.sk })
            .catch((err: unknown) => deps.log("updateNowPlaying failed:", errText(err)));
        })();
      }),
    );

    this.disposables.push(
      hub.onEvent(PROVIDER_ID, "scrobble", (payload) => {
        void (async () => {
          const s = await session();
          if (!s) return;
          const cfg = await deps.getConfig();
          if (!cfg.scrobbling) return;
          const { track, startedAtEpochSec } = payload as PluginEvents["scrobble"];
          await s.client
            .call(
              "track.scrobble",
              { ...trackParams(track), timestamp: String(startedAtEpochSec) },
              { sk: s.sk },
            )
            .catch((err: unknown) => {
              deps.log("scrobble failed:", errText(err));
              deps.notify(`Last.fm scrobble failed: ${errText(err)}`, "error");
            });
        })();
      }),
    );

    this.disposables.push(
      hub.onEvent(PROVIDER_ID, "trackRated", (payload) => {
        void (async () => {
          const s = await session();
          if (!s) return;
          const cfg = await deps.getConfig();
          if (!cfg.loveOnRating) return;
          const { track, rating10 } = payload as PluginEvents["trackRated"];
          const method = rating10 !== null && rating10 >= 8 ? "track.love" : "track.unlove";
          await s.client
            .call(method, { artist: track.artistName, track: track.title }, { sk: s.sk })
            .catch((err: unknown) => deps.log("love-sync failed:", errText(err)));
        })();
      }),
    );

    const self = this;
    return {
      dispose() {
        for (const d of self.disposables) d.dispose();
        self.disposables = [];
      },
    };
  }

  /** Connect the Last.fm account (starts the auth poll loop).
   *  Assigned by start(); null before start() is called. */
  connect: (() => Promise<{ ok: boolean; message: string }>) | null = null;
}
