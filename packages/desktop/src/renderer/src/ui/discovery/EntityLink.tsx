import type { ReactNode } from "react";
import { useApp } from "../../state/app";
import { type EntityRef, resolveEntityTarget } from "./entity-target";

/** A consistent, navigable name. Owned → detail view; unowned-with-provider →
 *  external-artist; otherwise renders plain text (no dead links). */
export function EntityLink({ ref, children }: { ref: EntityRef; children: ReactNode }) {
  const { dispatch } = useApp();
  const target = resolveEntityTarget(ref);
  if (!target) return <span>{children}</span>;
  return (
    <button
      type="button"
      className="link-quiet"
      onClick={() => dispatch({ type: "navigate", view: target })}
    >
      {children}
    </button>
  );
}
