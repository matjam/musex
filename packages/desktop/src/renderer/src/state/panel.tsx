import { createContext, type ReactNode, useContext, useMemo, useState } from "react";

export type PanelKind = "track" | "queue" | "artist-info";

/** Which right-hand side panel is open. One at a time — summoning a panel
 *  over another replaces it (the host animates the content swap). */
interface PanelApi {
  panel: PanelKind | null;
  /** Payload for the artist-info panel (set by openArtistInfo). */
  artistInfoName: string | null;
  /** Open a payload-free panel. Use openArtistInfo for the artist-info panel. */
  openPanel(kind: Exclude<PanelKind, "artist-info">): void;
  openArtistInfo(artistName: string): void;
  /** Close the open panel; with `kind`, only if that panel is the open one. */
  closePanel(kind?: PanelKind): void;
  /** Toggle a panel open/closed. Use openArtistInfo to open the artist-info panel. */
  togglePanel(kind: Exclude<PanelKind, "artist-info">): void;
}

const Ctx = createContext<PanelApi | null>(null);

export function PanelProvider({ children }: { children: ReactNode }) {
  const [panel, setPanel] = useState<PanelKind | null>(null);
  const [artistInfoName, setArtistInfoName] = useState<string | null>(null);
  const api = useMemo<PanelApi>(
    () => ({
      panel,
      artistInfoName,
      openPanel: (kind) => setPanel(kind),
      openArtistInfo: (artistName) => {
        setArtistInfoName(artistName);
        setPanel("artist-info");
      },
      closePanel: (kind) => setPanel((cur) => (kind === undefined || cur === kind ? null : cur)),
      togglePanel: (kind) => setPanel((cur) => (cur === kind ? null : kind)),
    }),
    [panel, artistInfoName],
  );
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function usePanel(): PanelApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("usePanel must be used within PanelProvider");
  return v;
}
