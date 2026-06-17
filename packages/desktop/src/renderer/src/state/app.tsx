import type { Album, Artist, Library, Playlist } from "@musex/core";
import {
  EMPTY_HISTORY,
  goBack,
  goForward,
  type NavHistory,
  pushView,
  type SmartKind,
  sameView,
} from "@musex/core";
import { createContext, type ReactNode, useContext, useEffect, useReducer } from "react";
import type { SimilarGetArgs } from "../../../shared/ipc-contract";

type AuthState = "restoring" | "signed-out" | "signing-in" | "signed-in";
export type View =
  | { name: "home" }
  | { name: "discover" }
  | { name: "albums" }
  | { name: "artists" }
  | { name: "genres" }
  | { name: "genre"; genre: string }
  | { name: "mix"; mixId: string }
  | { name: "tracks" }
  | { name: "album"; album: Album }
  | { name: "artist"; artist: Artist }
  | { name: "search" }
  | { name: "playlist"; playlist: Playlist }
  | { name: "smart"; kind: SmartKind }
  | { name: "external-artist"; artistName: string }
  | { name: "similar"; target: SimilarGetArgs }
  | { name: "downloads" };

interface AppState {
  auth: AuthState;
  signInCode: string | null;
  library: Library | null;
  view: View;
  searchQuery: string;
  history: NavHistory<View>;
}
type Action =
  | { type: "signing-in"; code: string }
  | { type: "signed-in"; library: Library }
  | { type: "restore-done"; library: Library | null }
  | { type: "navigate"; view: View }
  | { type: "set-search"; query: string }
  | { type: "library-updated"; library: Library }
  | { type: "library-switched"; library: Library }
  | { type: "nav-back" }
  | { type: "nav-forward" };

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
        view: { name: "home" },
        history: EMPTY_HISTORY,
      };
    case "restore-done":
      return a.library
        ? {
            ...s,
            auth: "signed-in",
            library: a.library,
            signInCode: null,
            view: { name: "home" },
            history: EMPTY_HISTORY,
          }
        : { ...s, auth: "signed-out" };
    case "navigate": {
      if (sameView(s.view, a.view)) return s;
      return { ...s, view: a.view, history: pushView(s.history, s.view) };
    }
    case "set-search": {
      const entering = a.query.trim() !== "" && s.view.name !== "search";
      return {
        ...s,
        searchQuery: a.query,
        view: a.query.trim() ? { name: "search" } : s.view,
        history: entering ? pushView(s.history, s.view) : s.history,
      };
    }
    case "library-updated":
      // Only refresh in place — never resurrect a stale push after sign-out
      // or a library switch. View/search state stays untouched.
      if (s.auth !== "signed-in" || !s.library || s.library.id !== a.library.id) return s;
      return { ...s, library: a.library };
    case "library-switched":
      return { ...s, library: a.library, view: { name: "home" }, history: EMPTY_HISTORY };
    case "nav-back": {
      const r = goBack(s.history, s.view);
      if (!r) return s;
      // Leaving search via history clears the box — a stale query over a
      // non-search view looks wrong (and would re-enter search on edit).
      const leavingSearch = s.view.name === "search" && r.view.name !== "search";
      return {
        ...s,
        view: r.view,
        history: r.history,
        searchQuery: leavingSearch ? "" : s.searchQuery,
      };
    }
    case "nav-forward": {
      const r = goForward(s.history, s.view);
      if (!r) return s;
      const leavingSearch = s.view.name === "search" && r.view.name !== "search";
      return {
        ...s,
        view: r.view,
        history: r.history,
        searchQuery: leavingSearch ? "" : s.searchQuery,
      };
    }
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
    view: { name: "home" },
    searchQuery: "",
    history: EMPTY_HISTORY,
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

  useEffect(() => {
    return window.musex.onLibraryChanged((library) => {
      dispatch({ type: "library-updated", library });
    });
  }, []);

  return <Ctx.Provider value={{ ...state, dispatch }}>{children}</Ctx.Provider>;
}

export function useApp(): AppApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp must be used within AppProvider");
  return v;
}
