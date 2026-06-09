import type { Track } from "@musex/core";
import { createContext, type ReactNode, useContext, useMemo, useState } from "react";

/** The currently highlighted track (single-click) shown in the detail panel.
 *  Independent of playback — selecting never plays. */
interface SelectionApi {
  selectedTrack: Track | null;
  select(track: Track): void;
  clear(): void;
}

const Ctx = createContext<SelectionApi | null>(null);

export function SelectionProvider({ children }: { children: ReactNode }) {
  const [selectedTrack, setSelectedTrack] = useState<Track | null>(null);
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
