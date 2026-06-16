export type AcquisitionBadgeState =
  | "owned"
  | "downloaded"
  | "downloading"
  | "requested"
  | "available"
  | "unavailable";

const LABELS: Record<AcquisitionBadgeState, string> = {
  owned: "In library",
  downloaded: "Downloaded",
  downloading: "Downloading",
  requested: "Requested",
  available: "Get",
  unavailable: "Unavailable",
};

export interface BadgeInfo {
  label: string;
  variant: AcquisitionBadgeState;
}

/** Pure: acquisition state (+ optional download percent) → badge label + variant.
 *  Returns null for unknown states so callers render nothing. */
export function acquisitionBadge(state: AcquisitionBadgeState, percent?: number): BadgeInfo | null {
  const base = LABELS[state];
  if (!base) return null;
  if (state === "downloading" && typeof percent === "number") {
    return { label: `Downloading ${Math.round(percent)}%`, variant: state };
  }
  return { label: base, variant: state };
}
