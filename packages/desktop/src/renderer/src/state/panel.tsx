import type { Track } from "@musex/core";
import { createContext, type ReactNode, useContext, useMemo, useState } from "react";

export type PanelKind = "queue" | "entity";

/** Payload for the context panel. The panel is a now-playing / track-detail
 *  context surface ONLY — entity navigation (artist/album) always goes to the
 *  unified pages, never the panel — so the only payload is a song. */
export type EntityPanelPayload = { kind: "song"; track: Track };

/** Which right-hand side panel is open. One at a time — summoning a panel
 *  over another replaces it (the host animates the content swap).
 *
 *  The "entity" panel is a CONTEXT surface: while it's open its content follows
 *  the user's focus (selected track → now-playing; see `derivePanelFocus`). It
 *  is never an entity-navigation destination and is never pinned to an entity. */
interface PanelApi {
  panel: PanelKind | null;
  /** Open a panel without a payload (the entity panel derives its content). */
  openPanel(kind: PanelKind): void;
  /** Close the open panel; with `kind`, only if that panel is the open one. */
  closePanel(kind?: PanelKind): void;
  /** Toggle a panel open/closed. */
  togglePanel(kind: PanelKind): void;
}

const Ctx = createContext<PanelApi | null>(null);

export function PanelProvider({ children }: { children: ReactNode }) {
  const [panel, setPanel] = useState<PanelKind | null>(null);

  const api = useMemo<PanelApi>(
    () => ({
      panel,
      openPanel: (kind) => setPanel(kind),
      closePanel: (kind) => setPanel((cur) => (kind === undefined || cur === kind ? null : cur)),
      togglePanel: (kind) => setPanel((cur) => (cur === kind ? null : kind)),
    }),
    [panel],
  );
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function usePanel(): PanelApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("usePanel must be used within PanelProvider");
  return v;
}
