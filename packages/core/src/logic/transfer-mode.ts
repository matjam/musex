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
