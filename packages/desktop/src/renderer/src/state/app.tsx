import type { Album, Artist, Library } from "@musex/core";
import { createContext, useContext, useReducer, type ReactNode } from "react";

type AuthState = "signed-out" | "signing-in" | "signed-in";
export type View =
  | { name: "albums" }
  | { name: "artists" }
  | { name: "album"; album: Album }
  | { name: "artist"; artist: Artist };

interface AppState {
  auth: AuthState;
  signInCode: string | null;
  library: Library | null;
  view: View;
}
type Action =
  | { type: "signing-in"; code: string }
  | { type: "signed-in"; library: Library }
  | { type: "navigate"; view: View };

function reducer(s: AppState, a: Action): AppState {
  switch (a.type) {
    case "signing-in":
      return { ...s, auth: "signing-in", signInCode: a.code };
    case "signed-in":
      return { ...s, auth: "signed-in", library: a.library, signInCode: null, view: { name: "albums" } };
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
    auth: "signed-out",
    signInCode: null,
    library: null,
    view: { name: "albums" },
  });
  return <Ctx.Provider value={{ ...state, dispatch }}>{children}</Ctx.Provider>;
}

export function useApp(): AppApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp must be used within AppProvider");
  return v;
}
