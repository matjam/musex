/** Coarse network class as reported by the platform (NetInfo's `state.type`
 *  collapsed): the only distinction the routing rule cares about is cellular
 *  vs everything else. */
export type ConnectionType = "wifi" | "cellular" | "other" | "none";

/** Decide how one download should travel — pure; the MANAGER owns
 *  capability/connection knowledge and feeds it in.
 *
 *  - original quality → `"original"` (unchanged, always).
 *  - aac + native on-device conversion available + not on cellular →
 *    `"convert"` (download the original via the unattended native engine,
 *    convert to AAC on-device).
 *  - aac otherwise → `"hls"` (server transcode via the JS engine — cellular
 *    keeps the ~3×-smaller AAC transfer; Expo Go has no native module).
 *
 *  `"other"`/`"none"` count as non-cellular: wired/unknown ≈ wifi, and an
 *  offline enqueue just waits on the engine's retries. */
export function transferModeFor(i: {
  qualityMode: "original" | "aac";
  nativeConvertAvailable: boolean;
  connectionType: ConnectionType;
}): "original" | "hls" | "convert" {
  if (i.qualityMode === "original") return "original";
  if (i.nativeConvertAvailable && i.connectionType !== "cellular") return "convert";
  return "hls";
}

/** Containers AVFoundation's AVURLAsset can actually read — the on-device
 *  conversion pipeline (AVAssetReader→AVAssetWriter) opens the downloaded
 *  original with it, so a container outside this list (ogg/vorbis, opus,
 *  wma, …) fails "Cannot Open" every time: retry once → terminal fail →
 *  sync re-queues → an infinite convert-fail loop. */
const AV_CONVERTIBLE_CONTAINERS: ReadonlySet<string> = new Set([
  "flac",
  "mp3",
  "m4a",
  "aac",
  "alac",
  "wav",
  "aiff",
  "aif",
  "caf",
  "mp4",
]);

/** Whether an on-device (AVFoundation) conversion can read this container —
 *  the manager gates a would-be "convert" job to server HLS when it can't.
 *  Empty/unknown container → true: allow convert (mainstream cases carry a
 *  container, and the engine's terminal-failure path still backstops it). */
export function isAvConvertible(container: string): boolean {
  const c = container.trim().toLowerCase();
  if (c === "") return true;
  return AV_CONVERTIBLE_CONTAINERS.has(c);
}
