import { createContext, type ReactNode, useContext, useMemo, useState } from "react";

/** What the Similar side panel was opened for: an artist page's name, or the
 *  selected track's title+artist. null = panel closed. */
export type SimilarTarget =
  | { kind: "artist"; name: string }
  | { kind: "track"; title: string; artist: string };

interface SimilarApi {
  target: SimilarTarget | null;
  open(target: SimilarTarget): void;
  close(): void;
}

const Ctx = createContext<SimilarApi | null>(null);

export function SimilarProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<SimilarTarget | null>(null);
  const api = useMemo<SimilarApi>(
    () => ({
      target,
      open: (t) => setTarget(t),
      close: () => setTarget(null),
    }),
    [target],
  );
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useSimilar(): SimilarApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSimilar must be used within SimilarProvider");
  return v;
}
