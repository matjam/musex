import type { Album, Track } from "@musex/core";
import { createContext, type ReactNode, useContext, useMemo, useState } from "react";

export type PanelKind = "track" | "queue" | "artist-info" | "entity";

/** Payload for the unified entity panel — one of artist/album/song. */
export type EntityPanelPayload =
  | { kind: "artist"; artistName: string; artistId?: string; serverId?: string; thumb?: string }
  | { kind: "album"; album: Album }
  | { kind: "song"; track: Track };

/** Which right-hand side panel is open. One at a time — summoning a panel
 *  over another replaces it (the host animates the content swap). */
interface PanelApi {
  panel: PanelKind | null;
  /** Payload for the unified entity panel (set by openEntity). */
  entityPayload: EntityPanelPayload | null;
  /** Open a payload-free panel. Use openEntity/openArtistInfo for payload panels. */
  openPanel(kind: Exclude<PanelKind, "artist-info" | "entity">): void;
  /** Open the unified entity panel (artist/album/song). */
  openEntity(payload: EntityPanelPayload): void;
  /** Thin wrapper over openEntity for legacy artist-info callers. */
  openArtistInfo(artistName: string): void;
  /** Close the open panel; with `kind`, only if that panel is the open one. */
  closePanel(kind?: PanelKind): void;
  /** Toggle a panel open/closed. Use openEntity/openArtistInfo for payload panels. */
  togglePanel(kind: Exclude<PanelKind, "artist-info" | "entity">): void;
}

const Ctx = createContext<PanelApi | null>(null);

export function PanelProvider({ children }: { children: ReactNode }) {
  const [panel, setPanel] = useState<PanelKind | null>(null);
  const [entityPayload, setEntityPayload] = useState<EntityPanelPayload | null>(null);
  const api = useMemo<PanelApi>(
    () => ({
      panel,
      entityPayload,
      openPanel: (kind) => setPanel(kind),
      openEntity: (payload) => {
        setEntityPayload(payload);
        setPanel("entity");
      },
      // Routes through the unified entity panel; kept so existing callers work.
      openArtistInfo: (artistName) => {
        setEntityPayload({ kind: "artist", artistName });
        setPanel("entity");
      },
      closePanel: (kind) => setPanel((cur) => (kind === undefined || cur === kind ? null : cur)),
      togglePanel: (kind) => setPanel((cur) => (cur === kind ? null : kind)),
    }),
    [panel, entityPayload],
  );
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function usePanel(): PanelApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("usePanel must be used within PanelProvider");
  return v;
}
