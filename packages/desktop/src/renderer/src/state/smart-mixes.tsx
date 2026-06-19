import type { Library, Track } from "@musex/core";
import {
  composeForYou,
  computeSmartPlaylist,
  type ForYouInput,
  listValidator,
  type SmartKind,
} from "@musex/core";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useApp } from "./app";

/** All four smart-mix kinds, in Home-card order. */
const ALL_KINDS: SmartKind[] = ["for-you", "top-rated", "heavy-rotation", "rediscover"];

/** How many taste-profile top artists seed the For You mix. */
const FOR_YOU_SEEDS = 5;
/** Total owned artists (seeds + similar-owned) feeding the mix. */
const FOR_YOU_MAX_ARTISTS = 12;

/**
 * Compute one smart mix exactly the way the on-open view always has. Shared by
 * the background warm (SmartMixProvider) AND SmartPlaylistView's cold-open
 * fallback so the mix logic lives in ONE place.
 *
 * The three rule-based kinds: all library tracks + taste snapshot → pure rules.
 */
export async function computeMix(kind: SmartKind, library: Library): Promise<Track[]> {
  if (kind === "for-you") return computeForYouMix(library);
  const validator = listValidator(library.updatedAt);
  const [tracks, snapshot] = await Promise.all([
    window.musex.listAllTracks(library.id, "title", validator),
    window.musex.getTasteSnapshot(),
  ]);
  return computeSmartPlaylist(kind, tracks, snapshot.stats, snapshot.topArtists, Date.now());
}

/**
 * For You: taste snapshot → top seed artists → resolve each seed to an OWNED
 * artist (live search, exact name match) + collect owned artists SIMILAR to it
 * (similarGet; needs a similar-provider plugin) → fetch every candidate
 * artist's tracks via the cached album/track lists → pure composer.
 * similarGet/search failures degrade to whatever resolved (own-artists-only is
 * still a useful mix); per-artist track fetch failures skip that artist.
 */
async function computeForYouMix(library: Library): Promise<Track[]> {
  const snapshot = await window.musex.getTasteSnapshot();
  const seeds = snapshot.topArtists.slice(0, FOR_YOU_SEEDS);
  if (seeds.length === 0) return [];

  const ownTop: (ForYouInput["ownTop"][number] & { updatedAt?: number })[] = [];
  const similarCandidates: ForYouInput["similarOwned"] = [];
  // Seeds are processed sequentially (polite to Plex + the similar provider);
  // within a seed the search and similarGet fan out together.
  for (const seed of seeds) {
    const [own, similar] = await Promise.all([
      window.musex
        .search(library.id, seed.name)
        .then(
          (results) =>
            results.artists.find((a) => a.name.toLowerCase() === seed.name.toLowerCase()) ?? null,
        )
        .catch((err: unknown) => {
          console.warn(`[for-you] artist search failed for "${seed.name}":`, err);
          return null;
        }),
      window.musex.similarGet({ kind: "artist", name: seed.name }).catch((err: unknown) => {
        console.warn(`[for-you] similarGet failed for "${seed.name}":`, err);
        return [];
      }),
    ]);
    if (own) {
      ownTop.push({
        artistId: own.id,
        name: own.name,
        score: seed.score,
        updatedAt: own.updatedAt,
      });
    }
    for (const item of similar) {
      if (item.artistId) {
        similarCandidates.push({ artistId: item.artistId, name: item.name, viaArtist: seed.name });
      }
    }
  }

  // Unique owned artists, seeds first, capped.
  const seen = new Set(ownTop.map((a) => a.artistId));
  const similarOwned: ForYouInput["similarOwned"] = [];
  for (const c of similarCandidates) {
    if (ownTop.length + similarOwned.length >= FOR_YOU_MAX_ARTISTS) break;
    if (seen.has(c.artistId)) continue;
    seen.add(c.artistId);
    similarOwned.push(c);
  }

  // Fetch each artist's tracks (cached lists): albums in parallel per artist,
  // artists sequential to be polite.
  const tracksByArtist = new Map<string, Track[]>();
  const candidates: { artistId: string; updatedAt?: number }[] = [...ownTop, ...similarOwned];
  for (const artist of candidates) {
    try {
      const albums = await window.musex.listAlbums(
        library.id,
        artist.artistId,
        listValidator(artist.updatedAt),
      );
      const arrays = await Promise.all(
        albums.map((a) => window.musex.listTracks(library.id, a.id, listValidator(a.updatedAt))),
      );
      tracksByArtist.set(artist.artistId, arrays.flat());
    } catch (err) {
      console.warn(`[for-you] track fetch failed for artist ${artist.artistId}:`, err);
    }
  }

  const stats = new Map(
    snapshot.stats.map((s) => [
      s.key,
      { plays: s.plays, skips: s.skips, lastPlayedMs: s.lastPlayedMs, ratingStars: s.ratingStars },
    ]),
  );
  return composeForYou({
    ownTop: ownTop.map(({ artistId, name, score }) => ({ artistId, name, score })),
    similarOwned,
    tracksByArtist,
    stats,
    nowMs: Date.now(),
  });
}

/** Per-kind cache entry. Only "ready" entries are served instantly to the view. */
export type MixEntry =
  | { status: "warming" }
  | { status: "ready"; tracks: Track[] }
  | { status: "error" };

interface SmartMixApi {
  /** The ready cache entry for a kind, or undefined (cold / still warming / failed). */
  get(kind: SmartKind): Track[] | undefined;
  /** Per-kind status (for diagnostics; the view only branches on `get`). */
  statusOf(kind: SmartKind): MixEntry["status"] | "cold";
  /** Compute all four mixes in the background. Reentrancy-safe (skips if already warming). */
  warm(): void;
}

const Ctx = createContext<SmartMixApi | null>(null);

export function SmartMixProvider({ children }: { children: ReactNode }) {
  const { library } = useApp();
  const [mixes, setMixes] = useState<Map<SmartKind, MixEntry>>(() => new Map());
  // Reentrancy guard: a warm in flight must not start a second overlapping run.
  const warmingRef = useRef(false);
  // The current library, read inside warm() without making warm() change identity.
  const libraryRef = useRef<Library | null>(library);
  libraryRef.current = library;

  const warm = useCallback(() => {
    if (warmingRef.current) return; // already warming — skip
    const lib = libraryRef.current;
    if (!lib) return;
    warmingRef.current = true;
    const libId = lib.id;
    // Mark every kind as warming up front so a re-open mid-warm shows progress.
    setMixes((prev) => {
      const next = new Map(prev);
      for (const kind of ALL_KINDS) next.set(kind, { status: "warming" });
      return next;
    });
    // Compute each mix independently; one failing must not abort the others.
    const jobs = ALL_KINDS.map((kind) =>
      computeMix(kind, lib)
        .then((tracks) => {
          // Drop results for a library we've since switched away from.
          if (libraryRef.current?.id !== libId) return;
          setMixes((prev) => new Map(prev).set(kind, { status: "ready", tracks }));
        })
        .catch((err: unknown) => {
          console.warn(`[smart-mixes] warm failed for "${kind}":`, err);
          if (libraryRef.current?.id !== libId) return;
          // Leave it as an error so the view's on-open fallback computes it.
          setMixes((prev) => new Map(prev).set(kind, { status: "error" }));
        }),
    );
    void Promise.allSettled(jobs).finally(() => {
      warmingRef.current = false;
    });
  }, []);

  // Re-warm whenever the library identity or content changes. `library.id`
  // covers a switch; `library.updatedAt` covers an in-place Plex update — both
  // are exactly the keys list validators use, so a bumped updatedAt means the
  // cached lists (and therefore the mixes) are stale. A recorded play does NOT
  // bump these, so this never thrashes on playback.
  // biome-ignore lint/correctness/useExhaustiveDependencies: warm reads libraryRef, library fields are the real triggers
  useEffect(() => {
    if (!library) return;
    // Clear stale entries from the previous library so the view never serves
    // another library's mix before the fresh warm lands.
    setMixes(new Map());
    warm();
  }, [library?.id, library?.updatedAt, warm]);

  const api = useMemo<SmartMixApi>(
    () => ({
      get: (kind) => {
        const e = mixes.get(kind);
        return e?.status === "ready" ? e.tracks : undefined;
      },
      statusOf: (kind) => mixes.get(kind)?.status ?? "cold",
      warm,
    }),
    [mixes, warm],
  );

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useSmartMixes(): SmartMixApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSmartMixes must be used within SmartMixProvider");
  return v;
}
