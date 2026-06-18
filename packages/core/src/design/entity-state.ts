import type { ResolvedEntity } from "../logic/entity-ref.js";
import type { colors } from "./tokens.js";

export type EntityState =
  | "owned"
  | "unowned"
  | "downloaded"
  | "downloading"
  | "following"
  | "acquiring"
  | "available"
  | "unavailable";

/** Shared badge vocabulary — both apps render identical badges from this table.
 *  `colorToken` is a real `colors` key; `icon` is a lucide name. */
export const ENTITY_STATE: Record<
  EntityState,
  { label: string; colorToken: keyof typeof colors; icon: string }
> = {
  owned: { label: "In library", colorToken: "green", icon: "library" },
  unowned: { label: "Not in library", colorToken: "muted", icon: "circle-dashed" },
  downloaded: { label: "Downloaded", colorToken: "green", icon: "hard-drive-download" },
  downloading: { label: "Downloading", colorToken: "yellow", icon: "loader" },
  following: { label: "Following", colorToken: "purple", icon: "heart" },
  acquiring: { label: "Acquiring", colorToken: "yellow", icon: "download" },
  available: { label: "Available", colorToken: "text", icon: "plus" },
  unavailable: { label: "Unavailable", colorToken: "muted", icon: "ban" },
};

export interface EntityStateFlags {
  downloaded?: boolean;
  downloading?: boolean;
  following?: boolean;
  acquiring?: boolean;
  unavailable?: boolean;
}

/** Compute the current display state for a resolved entity, given live flags. */
export function entityState(resolved: ResolvedEntity, flags: EntityStateFlags): EntityState {
  if (flags.downloading) return "downloading";
  if (flags.acquiring) return "acquiring";
  if (flags.downloaded) return "downloaded";
  if (flags.following) return "following";
  if (flags.unavailable && resolved.ref.source === "external") return "unavailable";
  if (resolved.ref.source === "plex") return "owned";
  if (resolved.affordances.acquirable) return "available";
  return "unowned";
}
