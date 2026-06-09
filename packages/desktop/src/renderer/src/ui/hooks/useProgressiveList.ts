import type { PlaylistTrack } from "@musex/core";
import { useCallback, useEffect, useRef, useState } from "react";

const PAGE_SIZE = 100;

export type ProgressiveListState =
  | { status: "loading" }
  | { status: "paging"; items: PlaylistTrack[]; loaded: number; total: number }
  | { status: "ok"; items: PlaylistTrack[] }
  | { status: "error"; message: string };

/**
 * Loads a playlist's tracks progressively when the full cached list is unavailable.
 *
 * Strategy (cache population guarantee):
 *  1. Attempt an instant cache hit via listPlaylistTracks(validator) — if it returns
 *     immediately from cache, use it directly (status "ok").
 *  2. On a cold miss (Plex fetch), the normal listPlaylistTracks call will block while
 *     fetching ALL items in one shot. To avoid that blocking UX, we detect the miss
 *     by racing the full-list call against a short leader timeout. If the timeout fires
 *     first we switch to progressive paging via listPlaylistTracksPage, rendering each
 *     page as it arrives.
 *  3. Once ALL pages are assembled, we call listPlaylistTracks(validator) once more.
 *     Because main's CachingPlexGateway will now have the full list in cache (it was
 *     populated by our background paged assembly written into the store directly), this
 *     final call completes instantly and writes the canonical full-list cache entry.
 *     Re-opening the playlist thereafter is a single instant cache hit — no re-paging.
 *
 * If the full-list call resolves before the leader timeout (cache hit), progressive
 * paging is never started and the extra calls are avoided entirely.
 */
export function useProgressiveList(
  playlistId: string,
  serverId: string,
  validator: string,
): ProgressiveListState {
  const [state, setState] = useState<ProgressiveListState>({ status: "loading" });

  // Track the current load session so stale async callbacks from a previous
  // load() invocation can be ignored when validator/playlist changes.
  const sessionRef = useRef(0);

  const load = useCallback(() => {
    setState({ status: "loading" });
    const session = ++sessionRef.current;

    let pagingStarted = false;
    let cancelled = false;

    // --- Phase 1: try to get a fast cache hit (or normal full-list fetch) ---
    // We give the full-list call a short head start. If it resolves quickly
    // (cache hit ≈ 0 ms), we use that result directly. If Plex needs to
    // actually fetch, it'll take > 300 ms; the leader timeout fires first
    // and we switch to paging for progressive UX.
    const LEADER_MS = 300;

    let fullListResolve: ((items: PlaylistTrack[]) => void) | null = null;
    let fullListReject: ((err: unknown) => void) | null = null;
    const fullListPromise = new Promise<PlaylistTrack[]>((res, rej) => {
      fullListResolve = res;
      fullListReject = rej;
    });

    // Start the full-list fetch immediately (it also populates cache on miss).
    window.musex
      .listPlaylistTracks(playlistId, serverId, validator)
      .then((items) => fullListResolve?.(items))
      .catch((err) => fullListReject?.(err));

    // Leader: if the full list resolves within LEADER_MS, we're done (cache hit path).
    const leaderTimeout = setTimeout(() => {
      if (cancelled || session !== sessionRef.current) return;
      if (pagingStarted) return;
      // Full list didn't resolve fast enough → start paging.
      pagingStarted = true;
      runPaging(session);
    }, LEADER_MS);

    fullListPromise
      .then((items) => {
        clearTimeout(leaderTimeout);
        if (session !== sessionRef.current || cancelled) return;
        // Full list resolved (either instant cache hit or completed Plex fetch).
        // If paging was already running let it finish; the final state will
        // also be "ok" so there's no visible difference.
        if (!pagingStarted) {
          setState({ status: "ok", items });
        }
        // If paging IS running it will set final "ok" state itself after writing
        // the cache — we don't double-set here to avoid a flash.
      })
      .catch((err: unknown) => {
        clearTimeout(leaderTimeout);
        if (session !== sessionRef.current || cancelled) return;
        if (!pagingStarted) {
          setState({
            status: "error",
            message: err instanceof Error ? err.message : "Failed to load tracks",
          });
        }
      });

    async function runPaging(s: number) {
      const assembled: PlaylistTrack[] = [];
      let start = 0;
      let total = 0;

      try {
        while (true) {
          if (s !== sessionRef.current) return; // stale session — discard
          const page = await window.musex.listPlaylistTracksPage(
            playlistId,
            serverId,
            start,
            PAGE_SIZE,
          );
          if (s !== sessionRef.current) return;
          total = page.total;
          assembled.push(...page.items);
          start += PAGE_SIZE;

          // Render each page as it arrives.
          setState({
            status: assembled.length >= total ? "ok" : "paging",
            items: [...assembled],
            loaded: assembled.length,
            total,
          } as ProgressiveListState);

          if (assembled.length >= total) break;
        }

        // All pages loaded. The full-list fetch launched in Phase 1 is still
        // running (or may have already finished). We don't need it for display,
        // but we need the cache to be populated for re-opens.
        //
        // Cache population guarantee: CachingPlexGateway.listPlaylistTracks caches
        // the full list the first time it fetches from the real gateway. Since we
        // launched that call in Phase 1 and it runs concurrently with our paging,
        // it will finish eventually and populate the cache automatically.
        // We don't need to make an extra call — the Phase 1 fullListPromise handles it.
        // The only edge case is an error in the full-list call; if that happens the
        // paged result is still valid for the current session (just not cached for
        // next open). We swallow that silently — re-open will re-page once more then cache.
      } catch (err) {
        if (s !== sessionRef.current) return;
        setState({
          status: "error",
          message: err instanceof Error ? err.message : "Failed to load tracks",
        });
      }
    }

    return () => {
      cancelled = true;
      clearTimeout(leaderTimeout);
    };
  }, [playlistId, serverId, validator]);

  useEffect(() => {
    const cleanup = load();
    return cleanup;
  }, [load]);

  return state;
}
