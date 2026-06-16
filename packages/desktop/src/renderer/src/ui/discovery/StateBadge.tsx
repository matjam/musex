import { Check, CircleDot, Download, Plus, X } from "lucide-react";
import { type AcquisitionBadgeState, acquisitionBadge } from "./state-badge";

const ICON = {
  owned: Check,
  downloaded: Check,
  downloading: Download,
  requested: CircleDot,
  available: Plus,
  unavailable: X,
} as const;

/** One acquisition-state badge, used on every album/track card, row, and feed. */
export function StateBadge({ state, percent }: { state: AcquisitionBadgeState; percent?: number }) {
  const info = acquisitionBadge(state, percent);
  if (!info) return null;
  const Icon = ICON[info.variant];
  return (
    <span className={`state-badge state-badge--${info.variant}`}>
      <Icon size={11} />
      {info.label}
    </span>
  );
}
