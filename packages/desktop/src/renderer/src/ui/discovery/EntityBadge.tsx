import type { EntityState } from "@musex/core";
import { ENTITY_STATE } from "@musex/core";
import type { LucideIcon } from "lucide-react";
import {
  Ban,
  CircleDashed,
  Download,
  HardDriveDownload,
  Heart,
  Library,
  Loader,
  Plus,
} from "lucide-react";

/** Renderer allowlist mapping the lucide NAMES in the SP0 `ENTITY_STATE` table
 *  to concrete lucide components. Kept in lockstep with that table; an
 *  unmapped name falls back to a neutral dot (so a new state never crashes). */
const ICONS: Record<string, LucideIcon> = {
  library: Library,
  "circle-dashed": CircleDashed,
  "hard-drive-download": HardDriveDownload,
  loader: Loader,
  heart: Heart,
  download: Download,
  plus: Plus,
  ban: Ban,
};

/** One entity-state badge, rendered from the shared SP0 vocabulary
 *  (`ENTITY_STATE`): color token class + lucide icon + label. */
export function EntityBadge({ state }: { state: EntityState }) {
  const entry = ENTITY_STATE[state];
  const Icon = ICONS[entry.icon] ?? CircleDashed;
  return (
    <span className={`entity-badge entity-badge--${entry.colorToken}`} title={entry.label}>
      <Icon size={11} />
      {entry.label}
    </span>
  );
}
