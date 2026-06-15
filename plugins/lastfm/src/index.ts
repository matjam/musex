/**
 * @musex/plugin-lastfm — scrobbling, now-playing and a "Love" track action.
 *
 * Runs full-trust in the Electron main process; codes purely against the
 * @musex/plugin-api types (compile-time only) + node:crypto. Never imports
 * electron or any @musex runtime code.
 */

/** Static manifest — core plugins register through this instead of a
 *  plugin.json (which remains the format for USER plugins only). */
export const manifest = {
  id: "lastfm",
  name: "Last.fm",
  version: "0.1.0",
  apiVersion: 1,
} as const;

import type {
  PluginContext,
  PluginEvents,
  RecommendedTrack,
  Section,
  SimilarItem,
  TrackInfo,
} from "@musex/plugin-api";
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
/** Discover artwork (top-album covers — last.fm artist images are a dead
 *  generic placeholder): per-artist lookup cache in ctx.storage. */
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
function trackParams(t: TrackInfo): Record<string, string> {
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

export async function activate(ctx: PluginContext): Promise<void> {
  ctx.registerSettings([
    {
      kind: "text",
      key: "apiKey",
      label: "API key",
      help: "Sign in to last.fm in your browser, then create one at https://www.last.fm/api/account/create (leave callback URL blank)",
    },
    { kind: "password", key: "apiSecret", label: "Shared secret" },
    { kind: "action", key: "connect", label: "Connect Last.fm account" },
    { kind: "status", key: "connection" },
    { kind: "toggle", key: "scrobbling", label: "Scrobble plays" },
    { kind: "toggle", key: "loveOnRating", label: "Love tracks rated ★★★★ or more" },
  ]);

  if ((await ctx.storage.get<string>("connection")) === null) {
    await ctx.storage.set("connection", "Not connected");
  }

  const credentials = async (): Promise<{ apiKey: string; secret: string } | null> => {
    const apiKey = await ctx.storage.get<string>("apiKey");
    const secret = await ctx.secrets.get("apiSecret");
    if (!apiKey || !secret) return null;
    return { apiKey, secret };
  };

  const client = async (): Promise<LastfmClient | null> => {
    const creds = await credentials();
    if (!creds) return null;
    return new LastfmClient({ apiKey: creds.apiKey, secret: creds.secret, fetchFn: ctx.fetch });
  };

  /** Connected = key+secret present AND a stored session key. */
  const session = async (): Promise<{ client: LastfmClient; sk: string } | null> => {
    const c = await client();
    if (!c) return null;
    const sk = await ctx.secrets.get("sessionKey");
    if (!sk) return null;
    return { client: c, sk };
  };

  // ── Connect (desktop auth flow) ───────────────────────────────────────────
  ctx.onSettingsAction("connect", async () => {
    const creds = await credentials();
    if (!creds) return { ok: false, message: "Enter API key and shared secret first" };
    const c = new LastfmClient({ apiKey: creds.apiKey, secret: creds.secret, fetchFn: ctx.fetch });
    const { token } = await c.call<TokenResponse>("auth.getToken", {});
    ctx.ui.openExternal(
      `${AUTH_URL}?api_key=${encodeURIComponent(creds.apiKey)}&token=${encodeURIComponent(token)}`,
    );
    // Poll until the user approves in the browser. Error 14 ("unauthorized
    // token") just means not-approved-yet; any other error aborts (the host
    // maps a throw to { ok: false, message }).
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
      await ctx.secrets.set("sessionKey", res.session.key);
      await ctx.storage.set("username", res.session.name);
      await ctx.storage.set("connection", `Connected as ${res.session.name}`);
      ctx.ui.notify(`Connected to Last.fm as ${res.session.name}`);
      return { ok: true, message: `Connected as ${res.session.name}` };
    }
    return { ok: false, message: "Authorization not completed — try again" };
  });

  // ── Scrobbling (event subscribers; silent no-ops when not connected) ──────
  const scrobblingEnabled = async () => (await ctx.storage.get<boolean>("scrobbling")) !== false; // default on

  const onTrackStarted = async ({ track }: PluginEvents["trackStarted"]): Promise<void> => {
    const s = await session();
    if (!s || !(await scrobblingEnabled())) return;
    // Never retried, per last.fm guidance.
    await s.client.call("track.updateNowPlaying", trackParams(track), { sk: s.sk });
  };
  ctx.events.on("trackStarted", (payload) => {
    onTrackStarted(payload).catch((err) => ctx.log("updateNowPlaying failed:", errText(err)));
  });

  const onScrobble = async ({
    track,
    startedAtEpochSec,
  }: PluginEvents["scrobble"]): Promise<void> => {
    const s = await session();
    if (!s || !(await scrobblingEnabled())) return;
    await s.client.call(
      "track.scrobble",
      { ...trackParams(track), timestamp: String(startedAtEpochSec) },
      { sk: s.sk },
    );
  };
  ctx.events.on("scrobble", (payload) => {
    onScrobble(payload).catch((err) => {
      ctx.log("scrobble failed:", errText(err));
      ctx.ui.notify(`Last.fm scrobble failed: ${errText(err)}`, "error");
    });
  });

  // ── Rating → love sync (4★+ loved; lower or cleared unloved) ─────────────
  const loveOnRatingEnabled = async () =>
    (await ctx.storage.get<boolean>("loveOnRating")) !== false; // default on

  const onTrackRated = async ({ track, rating10 }: PluginEvents["trackRated"]): Promise<void> => {
    const s = await session();
    if (!s || !(await loveOnRatingEnabled())) return;
    const method = rating10 !== null && rating10 >= 8 ? "track.love" : "track.unlove";
    await s.client.call(method, { artist: track.artistName, track: track.title }, { sk: s.sk });
  };
  ctx.events.on("trackRated", (payload) => {
    // Log only — no toasts, no retries (a background sync, not a user action).
    onTrackRated(payload).catch((err) => ctx.log("love-sync failed:", errText(err)));
  });

  // ── "Love on Last.fm" track action ────────────────────────────────────────
  ctx.ui.contributeTrackAction({
    id: "lastfm-love",
    label: "Love on Last.fm",
    icon: "heart",
    onInvoke: async (track) => {
      const s = await session();
      if (!s) {
        ctx.ui.notify("Connect your Last.fm account first (Settings → Plugins)", "error");
        return;
      }
      try {
        await s.client.call(
          "track.love",
          { artist: track.artistName, track: track.title },
          { sk: s.sk },
        );
        ctx.ui.notify(`Loved "${track.title}" on Last.fm`);
      } catch (err) {
        ctx.ui.notify(`Last.fm love failed: ${errText(err)}`, "error");
      }
    },
  });

  // ── Discover: similar-artist sections ─────────────────────────────────────

  /** Fill item.imageUrl with each artist's top-album cover (last.fm artist
   *  images are a dead generic placeholder). Lookups go through a 30-day
   *  ctx.storage cache (url: null = known-miss, so misses aren't re-queried
   *  every open). A failed lookup only logs — art never breaks the caller.
   *  Shared by the Discover sections and the Similar-artists panel. */
  const applyArtistArt = async (
    c: LastfmClient,
    items: { name: string; imageUrl?: string }[],
  ): Promise<void> => {
    const names = [...new Set(items.map((i) => i.name))];
    if (names.length === 0) return;
    const cache = (await ctx.storage.get<ArtistArtCache>(ART_CACHE_KEY)) ?? {};
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
            { signed: false }, // read method — api_key only
          );
          cache[artist.toLowerCase()] = {
            url: pickImageUrl(res.topalbums?.album?.[0]?.image),
            fetchedAt: now,
          };
        } catch (err) {
          // Transient failure: log and leave uncached so the next open retries.
          ctx.log(`artist.getTopAlbums failed for "${artist}":`, errText(err));
        }
      }),
    );
    if (stale.length > 0) {
      // Cap the cache by dropping the oldest-fetched entries.
      let entries = Object.entries(cache);
      if (entries.length > ART_CACHE_MAX_ENTRIES) {
        entries = entries
          .sort((a, b) => b[1].fetchedAt - a[1].fetchedAt)
          .slice(0, ART_CACHE_MAX_ENTRIES);
      }
      await ctx.storage.set(ART_CACHE_KEY, Object.fromEntries(entries));
    }
    for (const item of items) {
      const url = cache[item.name.toLowerCase()]?.url;
      if (url) item.imageUrl = url;
    }
  };

  /** artist.getSimilar → SimilarItem[] (name + last.fm URL); shared by the
   *  Discover sections and the Similar-artists panel. Throws on API failure —
   *  callers log per-seed. */
  const fetchSimilarArtists = async (
    c: LastfmClient,
    artistName: string,
    limit: number,
  ): Promise<SimilarItem[]> => {
    const res = await c.call<SimilarResponse>(
      "artist.getSimilar",
      { artist: artistName, limit: String(limit), autocorrect: "1" },
      { signed: false }, // read method — api_key only
    );
    const raw = res.similarartists?.artist;
    return (Array.isArray(raw) ? raw : [])
      .filter((a) => typeof a.name === "string" && a.name.length > 0)
      .map((a) => {
        const match = a.match !== undefined ? Number(a.match) : Number.NaN;
        return {
          name: a.name,
          ...(typeof a.url === "string" ? { externalUrl: a.url } : {}),
          // last.fm returns match as a string ("0.81"); taste expansion needs it.
          ...(Number.isFinite(match) ? { match } : {}),
        };
      });
  };

  ctx.ui.contributeSections("discover", {
    id: "lastfm-similar",
    getSections: async (sectionCtx) => {
      const s = await session();
      if (!s) return []; // needs API key + connected account
      const sections: Section[] = [];
      // Seed from the host's taste profile (decayed affinity, best first);
      // fall back to plain recency until the profile has signal.
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
          ctx.log(`artist.getSimilar failed for "${artistName}":`, errText(err));
        }
      }
      try {
        await applyArtistArt(
          s.client,
          sections.flatMap((sec) => sec.items),
        );
      } catch (err) {
        // Artwork is decoration — a storage/lookup failure never drops sections.
        ctx.log("artist artwork lookup failed:", errText(err));
      }
      return sections;
    },
  });

  // ── Similar side panel: similar artists + similar songs ───────────────────
  ctx.ui.registerSimilarProvider({
    id: "lastfm-similar",
    topAlbums: async (artistName) => {
      const s = await session();
      if (!s) return []; // needs API key + connected account
      try {
        const res = await s.client.call<TopAlbumsResponse>(
          "artist.getTopAlbums",
          { artist: artistName, limit: "10", autocorrect: "1" },
          { signed: false }, // read method — api_key only
        );
        const raw = res.topalbums?.album;
        return (Array.isArray(raw) ? raw : []).flatMap((a) =>
          typeof a.name === "string" && a.name.length > 0 ? [{ title: a.name }] : [],
        );
      } catch (err) {
        ctx.log(`artist.getTopAlbums failed for "${artistName}":`, errText(err));
        return [];
      }
    },
    similarArtists: async (artistName) => {
      const s = await session();
      if (!s) return []; // needs API key + connected account
      try {
        const items = await fetchSimilarArtists(s.client, artistName, SIMILAR_PANEL_LIMIT);
        try {
          await applyArtistArt(s.client, items);
        } catch (err) {
          // Artwork is decoration — a storage/lookup failure never drops items.
          ctx.log("artist artwork lookup failed:", errText(err));
        }
        return items;
      } catch (err) {
        ctx.log(`artist.getSimilar failed for "${artistName}":`, errText(err));
        return [];
      }
    },
    artistInfo: async (artistName) => {
      const s = await session();
      if (!s) return null; // needs API key + connected account
      try {
        const res = await s.client.call<ArtistInfoResponse>(
          "artist.getInfo",
          { artist: artistName, autocorrect: "1" },
          { signed: false }, // read method — api_key only
        );
        const a = res.artist;
        if (!a || typeof a.name !== "string") return null;
        // bio.summary carries a trailing "<a href=…>Read more…</a>" — strip
        // the link and any other tags; the UI renders plain text.
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
        ctx.log(`artist.getInfo failed for "${artistName}":`, errText(err));
        return null;
      }
    },
    similarTracks: async ({ title, artist }) => {
      const s = await session();
      if (!s) return []; // needs API key + connected account
      try {
        const res = await s.client.call<SimilarTracksResponse>(
          "track.getSimilar",
          { artist, track: title, limit: String(SIMILAR_PANEL_LIMIT), autocorrect: "1" },
          { signed: false }, // read method — api_key only
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
        ctx.log(`track.getSimilar failed for "${artist} – ${title}":`, errText(err));
        return [];
      }
    },
  });

  // ── Radio: similar-track / similar-artist suggestions ─────────────────────
  ctx.registerTrackRecommender({
    id: "lastfm-similar-tracks",
    recommend: async (rctx) => {
      const s = await session();
      if (!s) return []; // needs API key + connected account
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
            { signed: false }, // read method — api_key only
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
          ctx.log(`track.getSimilar failed for "${seed.artist} – ${seed.title}":`, errText(err));
        }
      }
      const seedArtist = rctx.seedArtists[0];
      if (seedArtist !== undefined) {
        try {
          const res = await s.client.call<SimilarResponse>(
            "artist.getSimilar",
            { artist: seedArtist, limit: String(RADIO_SIMILAR_ARTISTS_LIMIT), autocorrect: "1" },
            { signed: false },
          );
          const raw = res.similarartists?.artist;
          for (const a of Array.isArray(raw) ? raw : []) {
            if (typeof a.name === "string" && a.name.length > 0) {
              out.push({ artistName: a.name }); // artist-level — host picks the tracks
            }
          }
        } catch (err) {
          ctx.log(`artist.getSimilar failed for "${seedArtist}":`, errText(err));
        }
      }
      return out;
    },
  });

  // ── Track detail: scrobble stats + tags ───────────────────────────────────
  ctx.ui.contributeTrackDetail({
    id: "lastfm-info",
    getDetail: async (track) => {
      const c = await client();
      if (!c) return null; // needs API key (+secret) at minimum
      const username = await ctx.storage.get<string>("username");
      try {
        const res = await c.call<TrackInfoResponse>(
          "track.getInfo",
          {
            artist: track.artistName,
            track: track.title,
            autocorrect: "1",
            // Connected account → last.fm includes userplaycount.
            ...(username ? { username } : {}),
          },
          { signed: false }, // read method — api_key only
        );
        const t = res.track;
        if (!t) return null;
        const rows: { label: string; value: string }[] = [];
        if (t.playcount !== undefined) rows.push({ label: "Scrobbles", value: count(t.playcount) });
        if (t.listeners !== undefined) rows.push({ label: "Listeners", value: count(t.listeners) });
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
        ctx.log("track.getInfo failed:", errText(err));
        return null;
      }
    },
  });
}
