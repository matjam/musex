import type { EntityRef } from "@musex/core";
import { useCallback } from "react";
import { useApp } from "../../state/app";
import { usePlayer } from "../../state/player";

/** How an album-tile ⋯ play action enqueues the fetched tracks. */
export type AlbumPlayMode = "now" | "next" | "shuffle";

/** Fetch-and-enqueue helpers for whole OWNED albums straight from a grid tile's
 *  ⋯ menu (no need to open the album view). Given an owned album `EntityRef`
 *  (source "plex", with `id`), fetch its tracks via the cached gateway and:
 *    now     → playTracks(tracks, 0)   (load + play from the start)
 *    next    → enqueueNext(tracks)
 *    shuffle → playTracksShuffled(tracks)
 *  Offline-tolerant: an external ref, a missing library, or a fetch failure is a
 *  no-op (the action needs the tracks, which aren't fetchable offline if the
 *  album isn't cached — better silent than throwing from a menu click). */
export function useAlbumPlayActions() {
  const { library } = useApp();
  const { playTracks, playTracksShuffled, enqueueNext } = usePlayer();

  const playAlbum = useCallback(
    async (ref: EntityRef, mode: AlbumPlayMode): Promise<void> => {
      // Only owned (Plex) albums have fetchable tracks.
      if (!library || ref.source !== "plex" || !ref.id) return;
      try {
        // No validator: the caching gateway does a fetch-WITHOUT-set, so this
        // live fetch never overwrites AlbumView's properly-validated cache entry
        // (a "0:0" validator would mismatch and evict the good entry).
        const tracks = await window.musex.listTracks(library.id, ref.id);
        if (tracks.length === 0) return;
        if (mode === "shuffle") playTracksShuffled(tracks);
        else if (mode === "next") enqueueNext(tracks);
        else playTracks(tracks, 0);
      } catch (err) {
        // The tracks aren't reachable (e.g. offline + not cached); a menu action
        // can't surface an error, so log and no-op rather than throw.
        console.error("[album-play] failed to load album tracks:", err);
      }
    },
    [library, playTracks, playTracksShuffled, enqueueNext],
  );

  return { playAlbum };
}
