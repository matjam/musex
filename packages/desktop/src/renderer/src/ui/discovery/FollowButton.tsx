import type { EntityKind, EntityRef } from "@musex/core";
import { Heart } from "lucide-react";
import { useState } from "react";
import { useFollow } from "../../state/follow";
import { useAcquisitionAvailable } from "../hooks/useAcquisitionAvailable";

/** Kind-aware wording for the follow control. Following = acquire + watch for
 *  new releases and only makes sense for an ARTIST ("Follow" / "Following").
 *  For an album or track the action is a local favorite/bookmark
 *  ("Favorite" / "Favorited"). The underlying FollowService semantics are
 *  identical; only the label differs, keyed on `ref.kind`. */
export interface FollowLabels {
  /** Verb when not yet followed/favorited. */
  off: string;
  /** State when followed/favorited. */
  on: string;
  /** ⋯ menu verb to remove the relationship. */
  remove: string;
}

export function followLabels(kind: EntityKind): FollowLabels {
  return kind === "artist"
    ? { off: "Follow", on: "Following", remove: "Unfollow" }
    : { off: "Favorite", on: "Favorited", remove: "Unfavorite" };
}

/** Following an EXTERNAL (unowned) artist acquires them via an acquisition
 *  provider; with no provider installed `followService.follow` throws and the
 *  optimistic toggle reverts. Callers gate the control on this so the user
 *  sees a disabled button with an explanation instead of a silent revert.
 *  Owned-artist/album/track follow (local favorite) is unaffected. */
export const NO_ACQUISITION_FOLLOW_TOOLTIP = "Connect an acquisition plugin to follow artists";

export function followNeedsAcquisition(ref: EntityRef): boolean {
  return ref.kind === "artist" && ref.source === "external";
}

/** Follow state + toggle for an entity, in the shape the `ActionBar` `monitor`
 *  pill expects (`on`/`busy`/`onToggle`). Backed by the FollowProvider; the
 *  toggle is optimistic (the store reverts on IPC failure). Use this where a
 *  caller already renders an ActionBar; use `<FollowButton>` standalone. */
export function useFollowAction(ref: EntityRef) {
  const follow = useFollow();
  const [busy, setBusy] = useState(false);
  const on = follow.isFollowed(ref);
  return {
    on,
    busy,
    onToggle: async () => {
      setBusy(true);
      try {
        await follow.setFollowed(ref, !on);
      } catch (err) {
        // The store already reverted the optimistic toggle.
        console.error("[follow] toggle failed:", err);
      } finally {
        setBusy(false);
      }
    },
  };
}

/** The one Follow control. "♥ Following" when followed, "Follow" otherwise.
 *  For an unowned (external) artist the title hints that Follow acquires the
 *  artist; with no acquisition provider the control is disabled (Follow would
 *  otherwise throw and silently revert). `disabled` (e.g. offline) blocks the
 *  toggle and shows `title`. */
export function FollowButton({
  entity,
  disabled,
  title,
}: {
  entity: EntityRef;
  disabled?: boolean;
  title?: string;
}) {
  const { on, busy, onToggle } = useFollowAction(entity);
  const acquisitionAvailable = useAcquisitionAvailable();
  const unownedArtist = followNeedsAcquisition(entity);
  const labels = followLabels(entity.kind);
  const isArtist = entity.kind === "artist";
  // An external-artist Follow needs an acquisition provider; without one the
  // service rejects, so disable rather than let the optimistic toggle revert.
  const blockedNoProvider = unownedArtist && !on && !acquisitionAvailable;
  const hint = blockedNoProvider
    ? NO_ACQUISITION_FOLLOW_TOOLTIP
    : (title ??
      (on
        ? isArtist
          ? "Following — click to unfollow"
          : "Favorited — click to remove"
        : unownedArtist
          ? "Follow — acquire this artist"
          : isArtist
            ? "Follow"
            : "Favorite"));
  return (
    <button
      type="button"
      className={`action-pill${on ? " action-pill--on" : ""}`}
      disabled={busy || disabled || blockedNoProvider}
      title={hint}
      onClick={() => void onToggle()}
    >
      <Heart size={15} />
      {on ? labels.on : labels.off}
    </button>
  );
}
