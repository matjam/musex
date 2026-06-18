import type { EntityRef } from "@musex/core";
import { Heart } from "lucide-react";
import { useState } from "react";
import { useFollow } from "../../state/follow";

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
 *  For an unowned (external) artist the title hints that Follow acquires +
 *  watches. `disabled` (e.g. offline) blocks the toggle and shows `title`. */
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
  const unownedArtist = entity.kind === "artist" && entity.source === "external";
  const hint =
    title ??
    (on
      ? "Following — click to unfollow"
      : unownedArtist
        ? "Follow — acquire + watch for new releases"
        : "Follow");
  return (
    <button
      type="button"
      className={`action-pill${on ? " action-pill--on" : ""}`}
      disabled={busy || disabled}
      title={hint}
      onClick={() => void onToggle()}
    >
      <Heart size={15} />
      {on ? "Following" : "Follow"}
    </button>
  );
}
