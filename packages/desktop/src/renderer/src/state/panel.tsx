import { createContext, type ReactNode, useContext, useMemo, useState } from "react";

export type PanelKind = "track" | "queue";

/** Which right-hand side panel is open. One at a time — summoning a panel
 *  over another replaces it (the host animates the content swap). */
interface PanelApi {
  panel: PanelKind | null;
  openPanel(kind: PanelKind): void;
  /** Close the open panel; with `kind`, only if that panel is the open one. */
  closePanel(kind?: PanelKind): void;
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
