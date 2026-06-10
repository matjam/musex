import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";
import type { TrackInfo } from "../../../shared/ipc-contract";

/** Session overlay of user ratings (itemId → 0–10 or null = unrated), layered
 *  over whatever rating came with the fetched data. Lets a click update every
 *  surface (rows, bar, panel) instantly without refetching lists. */
interface RatingsApi {
  /** Current rating for an item: overlay first, then the fetched fallback. 0–10 or null. */
  ratingFor(itemId: string, fallback?: number): number | null;
  /** Optimistically rate (stars 1–5) or clear (null); fires the IPC; reverts the overlay + logs on failure.
   *  Pass `trackInfo` when rating a TRACK so main can fire the `trackRated` plugin event (omit for
   *  artists); pass `artistName` when rating an ARTIST so the taste profile hears about it; pass
   *  `artistId` when rating an ALBUM so main evicts that artist's album-list cache. */
  rate(args: {
    serverId: string;
    itemId: string;
    stars: number | null;
    albumId?: string;
    artistId?: string;
    libraryId?: string;
    trackInfo?: TrackInfo;
    artistName?: string;
  }): void;
  /** Seed the overlay from a fresh fetch (e.g. artist page getUserRating). */
  seed(itemId: string, rating: number | null): void;
}

const Ctx = createContext<RatingsApi | null>(null);

export function RatingsProvider({ children }: { children: ReactNode }) {
  const [overlay, setOverlay] = useState(() => new Map<string, number | null>());

  const rate = useCallback<RatingsApi["rate"]>(
    ({ serverId, itemId, stars, albumId, artistId, libraryId, trackInfo, artistName }) => {
      const rating = stars === null ? null : stars * 2;
      // Snapshot the previous overlay entry so a failed IPC can revert exactly.
      let had = false;
      let prev: number | null = null;
      setOverlay((m) => {
        had = m.has(itemId);
        prev = m.get(itemId) ?? null;
        return new Map(m).set(itemId, rating);
      });
      window.musex
        .rateItem({ serverId, itemId, rating, albumId, artistId, libraryId, trackInfo, artistName })
        .catch((err) => {
          console.error("[ratings] rateItem failed:", err);
          setOverlay((m) => {
            const next = new Map(m);
            if (had) next.set(itemId, prev);
            else next.delete(itemId);
            return next;
          });
        });
    },
    [],
  );

  // Set-only-if-absent: a fetched value must never clobber a rating the user
  // clicked while the fetch was in flight (the click already wrote the overlay).
  const seed = useCallback<RatingsApi["seed"]>((itemId, rating) => {
    setOverlay((m) => (m.has(itemId) ? m : new Map(m).set(itemId, rating)));
  }, []);

  const api = useMemo<RatingsApi>(
    () => ({
      ratingFor: (itemId, fallback) =>
        overlay.has(itemId) ? (overlay.get(itemId) ?? null) : (fallback ?? null),
      rate,
      seed,
    }),
    [overlay, rate, seed],
  );
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useRatings(): RatingsApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("useRatings must be used within RatingsProvider");
  return v;
}
