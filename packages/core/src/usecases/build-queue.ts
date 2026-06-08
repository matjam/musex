import type { Queue, Track } from "../models/index";

export function buildQueue(tracks: Track[], startIndex = 0): Queue {
  const maxIndex = Math.max(tracks.length - 1, 0);
  const index = Math.min(Math.max(startIndex, 0), maxIndex);
  return { tracks, index };
}
