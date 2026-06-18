import type { EntityRef } from "../models/entity-ref.js";

/** Stable follow/identity key for an entity ref.
 *  Owned: `${kind}:plex:${id}`. External: lowercased, trimmed name parts. */
export function followKey(ref: EntityRef): string {
  if (ref.source === "plex") {
    return `${ref.kind}:plex:${ref.id}`;
  }
  const name = [ref.artistName, ref.name]
    .filter(Boolean)
    .map((s) => (s as string).trim().toLowerCase())
    .join("␟");
  return `${ref.kind}:external:${name}`;
}
