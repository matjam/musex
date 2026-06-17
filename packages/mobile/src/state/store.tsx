import type { Library, PlaybackState, Server, Track } from "@musex/core";
import {
  buildQueue,
  discoverMusicLibraries,
  PlaybackSession,
  PlayMonitor,
  pickDefaultLibrary,
  pickDefaultServer,
} from "@musex/core";
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
import { subscribeRemoteCommands } from "../adapters/lock-screen-commands";
import { PlexGatewayImpl } from "../adapters/plex-gateway";
import { loadSelectedLibrary, saveSelectedLibrary } from "../adapters/selected-library-store";
import { PlexStreamResolver } from "../adapters/stream-resolver";
import { SecureTokenStore } from "../adapters/token-store";
import { CLIENT_ID } from "../config-client-id";
import { artUrl } from "../logic/art-url";
import { TasteService } from "../taste/taste-service";

function safeBaseUrl(gateway: PlexGatewayImpl, serverId: string): string | null {
  try {
    return gateway.baseUrlFor(serverId);
  } catch {
    return null;
  }
}

/** Resolve which library to open: a still-valid persisted choice (priming its
 *  server's base URL), else the owned server's first library. Returns null if no
 *  library is reachable (the picker fallback handles that). Per-server failures
 *  fall through rather than aborting. */
async function resolveLibrary(
  gateway: PlexGatewayImpl,
  servers: Server[],
  token: string,
): Promise<Library | null> {
  const persisted = await loadSelectedLibrary();
  if (persisted) {
    const srv = servers.find((s) => s.id === persisted.serverId);
    if (srv) {
      try {
        const libs = await gateway.listMusicLibraries(srv, token);
        return libs.find((l) => l.id === persisted.id) ?? pickDefaultLibrary(libs);
      } catch {
        // persisted server unreachable -> fall through to the default
      }
    }
  }
  const def = pickDefaultServer(servers);
  if (def) {
    try {
      return pickDefaultLibrary(await gateway.listMusicLibraries(def, token));
    } catch {
      return null;
    }
  }
  return null;
}

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
  | { type: "signed-in"; token: string; servers: Server[]; library: Library | null }
  | { type: "library-selected"; library: Library }
  | { type: "signed-out" }
  | { type: "playback"; state: PlaybackState };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "bootstrapped":
      return { ...state, phase: action.token ? "signed-in" : "signed-out", token: action.token };
    case "signed-in":
      return {
        ...state,
        phase: "signed-in",
        token: action.token,
        servers: action.servers,
        library: action.library,
      };
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
  artBaseFor: (serverId: string) => string | null;
  token: string | null;
  taste: TasteService;
  selectLibrary: (library: Library) => Promise<void>;
  listAllLibraries: () => Promise<Library[]>;
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
  const serversRef = useRef<Server[]>([]);
  serversRef.current = state.servers;

  const gateway = useMemo(() => new PlexGatewayImpl(fetch, CLIENT_ID), []);
  const tokenStore = useMemo(() => new SecureTokenStore(), []);
  const engine = useMemo(() => new ExpoAudioEngine(), []);
  const taste = useMemo(() => new TasteService(), []);
  const monitor = useMemo(() => new PlayMonitor(), []);

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

  // Mirror session state into the reducer + push lock-screen metadata on track change.
  const lastTrackId = useRef<string | null>(null);
  useEffect(
    () =>
      session.subscribe((s) => {
        const completed = monitor.onState(s);
        if (completed) {
          taste.recordPlay(
            { title: completed.title, artistName: completed.artistName },
            completed.kind,
          );
        }
        dispatch({ type: "playback", state: s });
        const cur = s.queue ? s.queue.tracks[s.queue.index] : undefined;
        if (cur && cur.id !== lastTrackId.current) {
          lastTrackId.current = cur.id;
          const tok = tokenRef.current;
          const base = tok ? safeBaseUrl(gateway, cur.serverId) : null;
          engine.setNowPlaying({
            title: cur.title,
            artist: cur.artistName,
            album: cur.albumTitle,
            artwork: base && tok ? (artUrl(base, cur.thumb, tok) ?? undefined) : undefined,
          });
        }
      }),
    [session, engine, gateway, taste, monitor],
  );

  // Lock-screen / Control-Center next & previous -> queue navigation.
  useEffect(
    () =>
      subscribeRemoteCommands({
        onNext: () => void session.next(),
        onPrevious: () => void session.previous(),
      }),
    [session],
  );

  // Bootstrap: init audio session, restore token, discover servers.
  useEffect(() => {
    let alive = true;
    (async () => {
      await engine.init();
      await taste.init();
      const token = await tokenStore.load();
      if (!alive) return;
      if (!token) {
        dispatch({ type: "bootstrapped", token: null });
        return;
      }
      try {
        const servers = await gateway.listServers(token);
        const library = await resolveLibrary(gateway, servers, token);
        if (library) await saveSelectedLibrary(library);
        if (alive) dispatch({ type: "signed-in", token, servers, library });
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
  }, [engine, gateway, tokenStore, taste]);

  // loadQueue() loads AND auto-plays the start index (it calls engine.play()).
  const playTracks = useMemo(
    () => async (tracks: Track[], index: number) => {
      await session.loadQueue(buildQueue(tracks, index));
    },
    [session],
  );

  const selectLibrary = useMemo(
    () => async (library: Library) => {
      const tok = tokenRef.current;
      const srv = serversRef.current.find((s) => s.id === library.serverId);
      if (tok && srv) {
        try {
          await gateway.listMusicLibraries(srv, tok); // prime the base URL
        } catch {
          // ignore — browse will surface a connection error if truly unreachable
        }
      }
      await saveSelectedLibrary(library);
      dispatch({ type: "library-selected", library });
    },
    [gateway],
  );

  const listAllLibraries = useMemo(
    () => async (): Promise<Library[]> => {
      const tok = tokenRef.current;
      if (!tok) return [];
      const { libraries } = await discoverMusicLibraries(gateway, tok);
      return libraries;
    },
    [gateway],
  );

  const value: Store = {
    state,
    gateway,
    tokenStore,
    dispatch,
    playTracks,
    session,
    artBaseFor: (sid) => safeBaseUrl(gateway, sid),
    token: state.token,
    taste,
    selectLibrary,
    listAllLibraries,
  };
  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>;
}
