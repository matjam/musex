import type { ReactNode } from "react";
import { useApp } from "../../state/app";
import { type EntityRef, resolveEntityTarget } from "./entity-target";

/** A consistent, navigable name. Owned → detail view; unowned-with-provider →
 *  external-artist; otherwise renders plain text (no dead links). */
export function EntityLink({ entity, children }: { entity: EntityRef; children: ReactNode }) {
  const { dispatch } = useApp();
  const target = resolveEntityTarget(entity);
  if (!target) return <span>{children}</span>;
  return (
    <button
      type="button"
      className="link-quiet"
      // Clicks never propagate, so it's safe inside clickable rows (a track
      // row's select / double-click-to-play must not fire when a name is clicked).
      onClick={(e) => {
        e.stopPropagation();
        dispatch({ type: "navigate", view: target });
      }}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {children}
    </button>
  );
}
