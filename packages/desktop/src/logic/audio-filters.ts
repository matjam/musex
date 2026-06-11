/** Pure audio-filter knowledge: leveling modes, the EQ preset table, and the
 *  mpv `af` / `replaygain` property values they translate to. The controller
 *  and IPC layers only transport strings built here — free-form filter text
 *  never reaches mpv (a bad string can wedge its runtime filter reinit). */

export type LevelingMode = "off" | "replaygain" | "auto";

export interface AudioPrefs {
  leveling: LevelingMode;
  /** EQ preset id from EQ_PRESETS ("off" = no EQ). */
  eqPreset: string;
}

export const DEFAULT_AUDIO_PREFS: AudioPrefs = { leveling: "off", eqPreset: "off" };

export interface EqPreset {
  id: string;
  label: string;
  /** ffmpeg filtergraph fragment ("" = no EQ). Gains stay ≤6 dB to limit clipping. */
  graph: string;
}

export const EQ_PRESETS: readonly EqPreset[] = [
  { id: "off", label: "Off", graph: "" },
  { id: "bass-boost", label: "Bass Boost", graph: "bass=g=6:f=110" },
  { id: "bass-reducer", label: "Bass Reducer", graph: "bass=g=-6:f=110" },
  { id: "treble-boost", label: "Treble Boost", graph: "treble=g=4:f=4000" },
  { id: "vocal", label: "Vocal Boost", graph: "equalizer=f=3000:t=q:w=1:g=4" },
  { id: "loudness", label: "Loudness", graph: "bass=g=5:f=100,treble=g=3:f=8000" },
];

/** mpv `af` property value ("" = no filters). Auto leveling (dynaudnorm) goes
 *  AFTER the EQ in the graph so it also absorbs any gain the EQ added. */
export function buildAf(prefs: AudioPrefs): string {
  const parts: string[] = [];
  const preset = EQ_PRESETS.find((p) => p.id === prefs.eqPreset);
  if (preset?.graph) parts.push(preset.graph);
  if (prefs.leveling === "auto") parts.push("dynaudnorm");
  return parts.length ? `lavfi=[${parts.join(",")}]` : "";
}

/** mpv `replaygain` property value. Album gain (not track) so albums keep
 *  their internal dynamics. */
export function replaygainMode(prefs: AudioPrefs): "album" | "no" {
  return prefs.leveling === "replaygain" ? "album" : "no";
}

const LEVELING_MODES: readonly LevelingMode[] = ["off", "replaygain", "auto"];

/** Normalize untrusted input (IPC payloads, hand-edited store JSON): unknown
 *  modes/preset ids fall back to defaults rather than throwing. */
export function sanitizeAudioPrefs(raw: unknown): AudioPrefs {
  const obj = (typeof raw === "object" && raw !== null ? raw : {}) as Partial<
    Record<keyof AudioPrefs, unknown>
  >;
  const leveling = LEVELING_MODES.includes(obj.leveling as LevelingMode)
    ? (obj.leveling as LevelingMode)
    : DEFAULT_AUDIO_PREFS.leveling;
  const eqPreset = EQ_PRESETS.some((p) => p.id === obj.eqPreset)
    ? (obj.eqPreset as string)
    : DEFAULT_AUDIO_PREFS.eqPreset;
  return { leveling, eqPreset };
}
