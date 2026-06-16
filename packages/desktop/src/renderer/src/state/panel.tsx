import type { Album, Track } from "@musex/core";
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { useApp } from "./app";

export type PanelKind = "queue" | "entity";

/** Payload for the unified entity panel — one of artist/album/song. */
export type EntityPanelPayload =
  | { kind: "artist"; artistName: string; artistId?: string; serverId?: string; thumb?: string }
  | { kind: "album"; album: Album }
  | { kind: "song"; track: Track };

/** Which right-hand side panel is open. One at a time — summoning a panel
 *  over another replaces it (the host animates the content swap).
 *
 *  The "entity" panel is a CONTEXT surface: while it's open its content follows
 *  the user's focus (see `derivePanelFocus`). `focusOverride` pins a specific
 *  entity (e.g. peeking a plugin-section artist); it's cleared on navigation. */
interface PanelApi {
  panel: PanelKind | null;
  /** Pinned entity to show in the context panel, or null to let it derive. */
  focusOverride: EntityPanelPayload | null;
  /** Open a panel without a payload (the entity panel derives its content). */
  openPanel(kind: PanelKind): void;
  /** Open the entity panel pinned to a specific entity (artist/album/song). */
  openEntity(payload: EntityPanelPayload): void;
  /** Thin wrapper over openEntity for legacy artist-info callers. */
  openArtistInfo(artistName: string): void;
  /** Drop the pinned entity so the panel falls back to derived content. */
  clearFocusOverride(): void;
  /** Close the open panel; with `kind`, only if that panel is the open one. */
  closePanel(kind?: PanelKind): void;
  /** Toggle a panel open/closed. */
  togglePanel(kind: PanelKind): void;
}

const Ctx = createContext<PanelApi | null>(null);

export function PanelProvider({ children }: { children: ReactNode }) {
  const [panel, setPanel] = useState<PanelKind | null>(null);
  const [focusOverride, setFocusOverride] = useState<EntityPanelPayload | null>(null);
  const { view } = useApp();

  // Navigating clears the pinned entity — the context panel then follows the
  // new view live. (PanelProvider sits inside AppProvider, so useApp() works.)
  // biome-ignore lint/correctness/useExhaustiveDependencies: clear on each view change
  useEffect(() => {
    setFocusOverride(null);
  }, [view]);

  const api = useMemo<PanelApi>(
    () => ({
      panel,
      focusOverride,
      openPanel: (kind) => setPanel(kind),
      openEntity: (payload) => {
        setFocusOverride(payload);
        setPanel("entity");
      },
      // Routes through the unified entity panel; kept so existing callers work.
      openArtistInfo: (artistName) => {
        setFocusOverride({ kind: "artist", artistName });
        setPanel("entity");
      },
      clearFocusOverride: () => setFocusOverride(null),
      closePanel: (kind) => setPanel((cur) => (kind === undefined || cur === kind ? null : cur)),
      togglePanel: (kind) => setPanel((cur) => (cur === kind ? null : kind)),
    }),
    [panel, focusOverride],
  );
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function usePanel(): PanelApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("usePanel must be used within PanelProvider");
  return v;
}
