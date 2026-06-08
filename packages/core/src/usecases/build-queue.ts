import type { Queue, Track } from "../models/index";

export function buildQueue(tracks: Track[], startIndex = 0): Queue {
  const maxIndex = Math.max(tracks.length - 1, 0);
  const index = Math.min(Math.max(startIndex, 0), maxIndex);
  // Empty list yields index 0 as a sentinel ("no valid track"); PlaybackSession.playIndex guards against tracks[0] being undefined.
  return { tracks, index };
}
