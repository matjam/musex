import type { Library, PlaybackState, Server, Track } from "@musex/core";
import { buildQueue, PlaybackSession } from "@musex/core";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from "react";
import { ExpoAudioEngine } from "../adapters/audio-engine";
import { PlexGatewayImpl } from "../adapters/plex-gateway";
import { PlexStreamResolver } from "../adapters/stream-resolver";
import { SecureTokenStore } from "../adapters/token-store";
import { CLIENT_ID } from "../config-client-id";

type Phase = "loading" | "signed-out" | "signed-in";

interface State {
  phase: Phase;
  token: string | null;
  servers: Server[];
  library: Library | null;
  playback: PlaybackState | null;
}

type Action =
  | { type: "bootstrapped"; token: string | null }
  | { type: "signed-in"; token: string; servers: Server[] }
  | { type: "library-selected"; library: Library }
  | { type: "signed-out" }
  | { type: "playback"; state: PlaybackState };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "bootstrapped":
      return { ...state, phase: action.token ? "signed-in" : "signed-out", token: action.token };
    case "signed-in":
      return { ...state, phase: "signed-in", token: action.token, servers: action.servers };
    case "library-selected":
      return { ...state, library: action.library };
    case "signed-out":
      return { ...state, phase: "signed-out", token: null, servers: [], library: null };
    case "playback":
      return { ...state, playback: action.state };
    default:
      return state;
  }
}

interface Store {
  state: State;
  gateway: PlexGatewayImpl;
  tokenStore: SecureTokenStore;
  dispatch: (a: Action) => void;
  /** Build a queue from a track list and start playback at `index`. */
  playTracks: (tracks: Track[], index: number) => Promise<void>;
  session: PlaybackSession;
}

const StoreCtx = createContext<Store | null>(null);

export function useStore(): Store {
  const s = useContext(StoreCtx);
  if (!s) throw new Error("useStore outside StoreProvider");
  return s;
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, {
    phase: "loading",
    token: null,
    servers: [],
    library: null,
    playback: null,
  });

  // Always-current token, read by the resolver at resolve-time (the session is
  // long-lived and created before sign-in).
  const tokenRef = useRef<string | null>(null);
  tokenRef.current = state.token;

  const gateway = useMemo(() => new PlexGatewayImpl(fetch, CLIENT_ID), []);
  const tokenStore = useMemo(() => new SecureTokenStore(), []);
  const engine = useMemo(() => new ExpoAudioEngine(), []);

  // ONE long-lived session. PlaybackSession's 3rd ctor arg is `shuffleRest`
  // (a shuffle fn), NOT a state callback; state is observed via subscribe().
  const session = useMemo(() => {
    const resolver = new PlexStreamResolver(
      (sid) => gateway.baseUrlFor(sid),
      () => tokenRef.current ?? "",
      CLIENT_ID,
    );
    return new PlaybackSession(engine, resolver);
  }, [engine, gateway]);

  // Mirror session state into the reducer. subscribe() returns the unsubscribe.
  useEffect(() => session.subscribe((s) => dispatch({ type: "playback", state: s })), [session]);

  // Bootstrap: init audio session, restore token, discover servers.
  useEffect(() => {
    let alive = true;
    (async () => {
      await engine.init();
      const token = await tokenStore.load();
      if (!alive) return;
      if (!token) {
        dispatch({ type: "bootstrapped", token: null });
        return;
      }
      try {
        const servers = await gateway.listServers(token);
        if (alive) dispatch({ type: "signed-in", token, servers });
      } catch {
        // Bad/expired token -> signed out (never loop).
        await tokenStore.clear();
        if (alive) dispatch({ type: "bootstrapped", token: null });
      }
    })();
    return () => {
      alive = false;
      engine.dispose();
    };
  }, [engine, gateway, tokenStore]);

  // loadQueue() loads AND auto-plays the start index (it calls engine.play()).
  const playTracks = useMemo(
    () => async (tracks: Track[], index: number) => {
      await session.loadQueue(buildQueue(tracks, index));
    },
    [session],
  );

  const value: Store = { state, gateway, tokenStore, dispatch, playTracks, session };
  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>;
}
