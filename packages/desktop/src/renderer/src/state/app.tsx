import type { Album, Artist, Library, Playlist } from "@musex/core";
import { createContext, type ReactNode, useContext, useEffect, useReducer } from "react";

type AuthState = "restoring" | "signed-out" | "signing-in" | "signed-in";
export type View =
  | { name: "albums" }
  | { name: "artists" }
  | { name: "tracks" }
  | { name: "album"; album: Album }
  | { name: "artist"; artist: Artist }
  | { name: "settings" }
  | { name: "search" }
  | { name: "playlist"; playlist: Playlist };

interface AppState {
  auth: AuthState;
  signInCode: string | null;
  library: Library | null;
  view: View;
}
type Action =
  | { type: "signing-in"; code: string }
  | { type: "signed-in"; library: Library }
  | { type: "restore-done"; library: Library | null }
  | { type: "navigate"; view: View };

function reducer(s: AppState, a: Action): AppState {
  switch (a.type) {
    case "signing-in":
      return { ...s, auth: "signing-in", signInCode: a.code };
    case "signed-in":
      return {
        ...s,
        auth: "signed-in",
        library: a.library,
        signInCode: null,
        view: { name: "albums" },
      };
    case "restore-done":
      return a.library
        ? {
            ...s,
            auth: "signed-in",
            library: a.library,
            signInCode: null,
            view: { name: "albums" },
          }
        : { ...s, auth: "signed-out" };
    case "navigate":
      return { ...s, view: a.view };
  }
}

interface AppApi extends AppState {
  dispatch: React.Dispatch<Action>;
}
const Ctx = createContext<AppApi | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, {
    auth: "restoring",
    signInCode: null,
    library: null,
    view: { name: "albums" },
  });

  useEffect(() => {
    let cancelled = false;
    window.musex
      .restoreSession()
      .then(({ library }) => {
        if (!cancelled) dispatch({ type: "restore-done", library });
      })
      .catch(() => {
        if (!cancelled) dispatch({ type: "restore-done", library: null });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return <Ctx.Provider value={{ ...state, dispatch }}>{children}</Ctx.Provider>;
}

export function useApp(): AppApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp must be used within AppProvider");
  return v;
}
