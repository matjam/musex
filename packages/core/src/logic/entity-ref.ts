import type { EntityKind, EntityRef } from "../models/entity-ref.js";

/** Platform-agnostic navigation descriptor — each app maps it to its router. */
export type NavTarget = { kind: EntityKind; ref: EntityRef };

export interface ResolvedEntity {
  ref: EntityRef;
  nav: NavTarget;
  affordances: {
    playable: boolean;
    followable: boolean;
    acquirable: boolean;
    hasExternalInfo: boolean;
  };
}

/** Source-agnostic resolution: every entity navigates to its own page; the
 *  affordance set is derived purely from source + kind. */
export function resolveEntity(ref: EntityRef): ResolvedEntity {
  return {
    ref,
    nav: { kind: ref.kind, ref },
    affordances: {
      playable: ref.source === "plex",
      followable: true,
      acquirable: ref.source === "external" && (ref.kind === "artist" || ref.kind === "album"),
      hasExternalInfo: ref.kind === "artist",
    },
  };
}

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
