import type { EntityRef } from "@musex/core";
import type { ReactNode } from "react";
import { useApp } from "../../state/app";
import { viewForEntity } from "./entity-target";

/** A consistent, navigable entity name. Every entity (owned or external)
 *  resolves to its own unified page via `resolveEntity`; the navigation path
 *  no longer branches on ownership. */
export function EntityLink({ entity, children }: { entity: EntityRef; children: ReactNode }) {
  const { dispatch } = useApp();
  return (
    <button
      type="button"
      className="link-quiet"
      // Clicks never propagate, so it's safe inside clickable rows (a track
      // row's select / double-click-to-play must not fire when a name is clicked).
      onClick={(e) => {
        e.stopPropagation();
        dispatch({ type: "navigate", view: viewForEntity(entity) });
      }}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {children}
    </button>
  );
}
