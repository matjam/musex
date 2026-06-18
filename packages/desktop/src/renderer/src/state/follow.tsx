import type { EntityKind, EntityRef } from "@musex/core";
import { followKey } from "@musex/core";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
} from "react";

/** Follow state for the renderer, keyed two ways to match FollowService:
 *  - `keys`: stable `followKey`s (covers album/track favorites + owned-artist
 *    local follows),
 *  - `names`: lowercased artist names (covers the provider's monitored∪watched
 *    list, which FollowService reports by NAME — an owned artist monitored via
 *    the acquisition provider is followed even without a local key match). */
interface FollowState {
  keys: Set<string>;
  names: Set<string>;
}

type FollowReducerAction =
  | { type: "seed"; keys: string[]; names: string[] }
  | { type: "set"; ref: EntityRef; value: boolean };

const lc = (s: string) => s.trim().toLowerCase();

function reducer(state: FollowState, a: FollowReducerAction): FollowState {
  switch (a.type) {
    case "seed":
      return { keys: new Set(a.keys), names: new Set(a.names.map(lc)) };
    case "set": {
      const keys = new Set(state.keys);
      const names = new Set(state.names);
      const key = followKey(a.ref);
      if (a.value) keys.add(key);
      else keys.delete(key);
      if (a.ref.kind === "artist") {
        if (a.value) names.add(lc(a.ref.name));
        else names.delete(lc(a.ref.name));
      }
      return { keys, names };
    }
  }
}

interface FollowApi {
  /** Whether the entity is currently followed (cached; seeded from follow:list). */
  isFollowed(ref: EntityRef): boolean;
  /** Optimistically toggle follow, then persist via follow:set (revert on error). */
  setFollowed(ref: EntityRef, value: boolean): Promise<void>;
  /** Currently-followed refs of a kind (refreshed live from the cache seed). */
  following(kind: EntityKind): EntityRef[];
  /** Re-seed from the IPC (e.g. after an out-of-band acquire). */
  refresh(): void;
}

const Ctx = createContext<FollowApi | null>(null);

/** Reactive follow state, seeded from the FollowService (artists ∪ album/track
 *  favorites). Optimistic toggles; reverts on IPC failure. One store so every
 *  view stays consistent — replaces the old monitoring store. */
export function FollowProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, {
    keys: new Set<string>(),
    names: new Set<string>(),
  });
  // The list of followed refs (for `following`), kept alongside the sets so the
  // provider can return refs, not just membership. Re-seeded on refresh.
  const followedRefs = useMemo(
    () => ({ artist: [], album: [], track: [] }) as Record<EntityKind, EntityRef[]>,
    [],
  );

  const refresh = useCallback(() => {
    void Promise.all([
      window.musex.followList("artist"),
      window.musex.followList("album"),
      window.musex.followList("track"),
    ])
      .then(([artists, albums, tracks]) => {
        followedRefs.artist = artists;
        followedRefs.album = albums;
        followedRefs.track = tracks;
        const all = [...artists, ...albums, ...tracks];
        dispatch({
          type: "seed",
          keys: all.map(followKey),
          names: artists.map((r) => r.name),
        });
      })
      .catch((err: unknown) => console.error("[follow] seed failed:", err));
  }, [followedRefs]);

  useEffect(refresh, [refresh]);

  const api = useMemo<FollowApi>(
    () => ({
      isFollowed: (ref) =>
        state.keys.has(followKey(ref)) || (ref.kind === "artist" && state.names.has(lc(ref.name))),
      async setFollowed(ref, value) {
        dispatch({ type: "set", ref, value });
        try {
          await window.musex.followSet(ref, value);
        } catch (err) {
          dispatch({ type: "set", ref, value: !value });
          throw err;
        }
      },
      following: (kind) => followedRefs[kind],
      refresh,
    }),
    [state, refresh, followedRefs],
  );

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useFollow(): FollowApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("useFollow must be used within FollowProvider");
  return v;
}
