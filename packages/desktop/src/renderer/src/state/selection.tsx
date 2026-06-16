import type { Track } from "@musex/core";
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { useApp } from "./app";

/** The currently highlighted track (single-click). Independent of playback —
 *  selecting never plays, and never opens a panel: the (separately toggled)
 *  context panel picks the selection up via `derivePanelFocus`. */
interface SelectionApi {
  selectedTrack: Track | null;
  select(track: Track): void;
  clear(): void;
}

const Ctx = createContext<SelectionApi | null>(null);

export function SelectionProvider({ children }: { children: ReactNode }) {
  const [selectedTrack, setSelectedTrack] = useState<Track | null>(null);
  const { view } = useApp();

  // Drop a stale selection when the view changes so it doesn't override the
  // new view's derived entity (SelectionProvider sits inside AppProvider).
  // biome-ignore lint/correctness/useExhaustiveDependencies: clear on each view change
  useEffect(() => {
    setSelectedTrack(null);
  }, [view]);

  const api = useMemo<SelectionApi>(
    () => ({
      selectedTrack,
      select: (track) => setSelectedTrack(track),
      clear: () => setSelectedTrack(null),
    }),
    [selectedTrack],
  );
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useSelection(): SelectionApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSelection must be used within SelectionProvider");
  return v;
}
