import type { Library, PlaybackState, Server, Track } from "@musex/core";
import {
  advanceRadio,
  buildQueue,
  discoverMusicLibraries,
  PlaybackSession,
  PlayMonitor,
  pickDefaultLibrary,
  pickDefaultServer,
  type RadioState,
  radioKey,
  shouldTopUp,
} from "@musex/core";
import * as WebBrowser from "expo-web-browser";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { ExpoAudioEngine } from "../adapters/audio-engine";
import {
  clearSession,
  DEFAULT_LASTFM_CONFIG,
  type LastfmConfig,
  loadLastfmConfig,
  loadSecret,
  loadSessionKey,
  saveLastfmConfig,
  saveSecret,
  saveSessionKey,
} from "../adapters/lastfm-store";
import { subscribeRemoteCommands } from "../adapters/lock-screen-commands";
import { PlexGatewayImpl } from "../adapters/plex-gateway";
import { loadSelectedLibrary, saveSelectedLibrary } from "../adapters/selected-library-store";
import { PlexStreamResolver } from "../adapters/stream-resolver";
import { SecureTokenStore } from "../adapters/token-store";
import { CLIENT_ID } from "../config-client-id";
import { LastfmService } from "../lastfm/lastfm-service";
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
  /** Finish sign-in for a fresh token: discover + auto-select the owned library. */
  completeSignIn: (token: string) => Promise<void>;
  selectLibrary: (library: Library) => Promise<void>;
  listAllLibraries: () => Promise<Library[]>;
  lastfm: LastfmService;
  getLastfmConfig: () => LastfmConfig;
  setLastfmConfig: (cfg: LastfmConfig) => Promise<void>;
  connectLastfm: () => Promise<{ ok: boolean; message: string }>;
  disconnectLastfm: () => Promise<void>;
  setLastfmSecret: (secret: string) => Promise<void>;
  /** Radio snapshot for the UI (active + seed label). */
  radio: { active: boolean; seedLabel: string };
  /** Start radio seeded by an artist + optional track. Seeds the queue from last.fm recommendations. */
  startRadio: (seed: { artist: string; title?: string; label: string }) => void;
  stopRadio: () => void;
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

  // Last.fm config held in memory; persisted on every change.
  const lastfmConfigRef = useRef<LastfmConfig>(DEFAULT_LASTFM_CONFIG);

  const gateway = useMemo(() => new PlexGatewayImpl(fetch, CLIENT_ID), []);
  const tokenStore = useMemo(() => new SecureTokenStore(), []);
  const engine = useMemo(() => new ExpoAudioEngine(), []);
  const taste = useMemo(() => new TasteService(), []);
  const monitor = useMemo(() => new PlayMonitor(), []);

  const lastfm = useMemo(
    () =>
      new LastfmService({
        fetchFn: fetch,
        openAuth: async (url) => {
          await WebBrowser.openAuthSessionAsync(url, "musex://lastfm-callback");
        },
        getConfig: async () => lastfmConfigRef.current,
        setConfig: async (cfg) => {
          lastfmConfigRef.current = cfg;
          await saveLastfmConfig(cfg);
        },
        getSecret: loadSecret,
        setSecret: saveSecret,
        getSessionKey: loadSessionKey,
        setSessionKey: saveSessionKey,
        clearSession,
      }),
    [],
  );

  // Finish sign-in / restore: discover servers, auto-select the owned server's
  // library (or a still-valid persisted choice), persist it, and enter the app.
  // Shared by bootstrap (token already stored) and the sign-in screen (fresh
  // token) so the owned library is auto-picked on the first sign-in too.
  const completeSignIn = useMemo(
    () => async (token: string) => {
      try {
        const servers = await gateway.listServers(token);
        const library = await resolveLibrary(gateway, servers, token);
        if (library) await saveSelectedLibrary(library);
        dispatch({ type: "signed-in", token, servers, library });
      } catch {
        // Bad/expired token -> signed out (never loop).
        await tokenStore.clear();
        dispatch({ type: "bootstrapped", token: null });
      }
    },
    [gateway, tokenStore],
  );

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

  // Radio state: refs so the subscribe closure always sees the latest without
  // causing re-renders on every position tick.
  const radioStateRef = useRef<RadioState>({ active: false, emptyRounds: 0 });
  const radioSeedRef = useRef<{ artist: string; title?: string; label: string } | null>(null);
  const radioExcludeRef = useRef<Set<string>>(new Set());
  const topUpInFlightRef = useRef(false);
  // Snapshot for the UI: only updated when radio active/label changes.
  const [radioSnapshot, setRadioSnapshot] = useState<{ active: boolean; seedLabel: string }>({
    active: false,
    seedLabel: "",
  });

  const syncRadioSnapshot = useCallback(() => {
    setRadioSnapshot({
      active: radioStateRef.current.active,
      seedLabel: radioSeedRef.current?.label ?? "",
    });
  }, []);

  const stopRadio = useCallback(() => {
    radioStateRef.current = { active: false, emptyRounds: 0 };
    radioSeedRef.current = null;
    syncRadioSnapshot();
  }, [syncRadioSnapshot]);

  const doTopUp = useCallback(async () => {
    if (topUpInFlightRef.current) return;
    if (!radioStateRef.current.active) return;
    const seed = radioSeedRef.current;
    if (!seed) return;
    const lib = state.library;
    const tok = tokenRef.current;
    if (!lib || !tok) return;

    topUpInFlightRef.current = true;
    try {
      const candidates = await lastfm.recommend({ artist: seed.artist, title: seed.title }, 20);
      const resolved: Track[] = [];
      for (const c of candidates) {
        const candKey = radioKey(c.artist, c.title); // c.title is "" for artist-seed — fine, unique per artist
        if (radioExcludeRef.current.has(candKey)) continue;
        radioExcludeRef.current.add(candKey); // don't re-resolve this candidate next round
        try {
          const results = await gateway.search(lib, c.title ? c.title : c.artist, tok);
          const match = results.tracks.find(
            (t) => t.artistName.toLowerCase() === c.artist.toLowerCase(),
          );
          if (match) {
            resolved.push(match);
            radioExcludeRef.current.add(radioKey(match.artistName, match.title));
            if (resolved.length >= 5) break;
          }
        } catch {
          // search failure → skip
        }
      }
      if (!radioStateRef.current.active) return; // stopped mid-flight — drop results, finally still resets the in-flight flag
      void session.enqueueEnd(resolved);
      radioStateRef.current = advanceRadio(radioStateRef.current, resolved.length);
      syncRadioSnapshot();
    } finally {
      topUpInFlightRef.current = false;
    }
  }, [state.library, lastfm, gateway, session, syncRadioSnapshot]);

  const startRadio = useCallback(
    (seed: { artist: string; title?: string; label: string }) => {
      radioStateRef.current = { active: true, emptyRounds: 0 };
      radioSeedRef.current = seed;
      // Seed the exclude set with recent queue tracks (up to 50).
      const q = session.getState().queue;
      const exclude = new Set<string>();
      if (q) {
        const recent = q.tracks.slice(Math.max(0, q.tracks.length - 50));
        for (const t of recent) exclude.add(radioKey(t.artistName, t.title));
      }
      radioExcludeRef.current = exclude;
      syncRadioSnapshot();
      // Trigger an immediate top-up.
      void doTopUp();
    },
    [session, syncRadioSnapshot, doTopUp],
  );

  // Mirror session state into the reducer + push lock-screen metadata on track change.
  const lastTrackId = useRef<string | null>(null);
  // Ref for scrobble timing: when the current track started.
  const startedAtRef = useRef<number>(Date.now());
  useEffect(
    () =>
      session.subscribe((s) => {
        const completed = monitor.onState(s);
        if (completed) {
          taste.recordPlay(
            { title: completed.title, artistName: completed.artistName },
            completed.kind,
          );
          if (completed.kind === "full") {
            void lastfm.scrobble(
              { artistName: completed.artistName, title: completed.title },
              startedAtRef.current,
            );
          }
        }
        dispatch({ type: "playback", state: s });
        const cur = s.queue ? s.queue.tracks[s.queue.index] : undefined;
        if (cur && cur.id !== lastTrackId.current) {
          lastTrackId.current = cur.id;
          startedAtRef.current = Date.now();
          const tok = tokenRef.current;
          const base = tok ? safeBaseUrl(gateway, cur.serverId) : null;
          engine.setNowPlaying({
            title: cur.title,
            artist: cur.artistName,
            album: cur.albumTitle,
            artwork: base && tok ? (artUrl(base, cur.thumb, tok) ?? undefined) : undefined,
          });
          void lastfm.updateNowPlaying({
            artistName: cur.artistName,
            title: cur.title,
            albumTitle: cur.albumTitle,
            durationMs: cur.durationMs,
          });
        }
        // Radio top-up: when active and up-next count is below the threshold.
        if (radioStateRef.current.active && s.queue) {
          const upNextCount = s.queue.tracks.length - s.queue.index - 1;
          if (shouldTopUp(radioStateRef.current, upNextCount)) {
            void doTopUp();
          }
        }
      }),
    [session, engine, gateway, taste, monitor, lastfm, doTopUp],
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

  // Bootstrap: init audio session, restore token, discover servers, load last.fm config.
  useEffect(() => {
    let alive = true;
    (async () => {
      await engine.init();
      await taste.init();
      // Load last.fm config + secret into the in-memory ref before the service is used.
      const [lfmCfg] = await Promise.all([loadLastfmConfig(), loadSecret()]);
      lastfmConfigRef.current = lfmCfg;
      const token = await tokenStore.load();
      if (!alive) return;
      if (!token) {
        dispatch({ type: "bootstrapped", token: null });
        return;
      }
      if (alive) await completeSignIn(token);
    })();
    return () => {
      alive = false;
      engine.dispose();
    };
  }, [engine, tokenStore, taste, completeSignIn]);

  // loadQueue() loads AND auto-plays the start index (it calls engine.play()).
  // Starting a new collection stops radio.
  const playTracks = useCallback(
    async (tracks: Track[], index: number) => {
      radioStateRef.current = { active: false, emptyRounds: 0 };
      radioSeedRef.current = null;
      syncRadioSnapshot();
      await session.loadQueue(buildQueue(tracks, index));
    },
    [session, syncRadioSnapshot],
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
    completeSignIn,
    selectLibrary,
    listAllLibraries,
    lastfm,
    getLastfmConfig: () => lastfmConfigRef.current,
    setLastfmConfig: async (cfg) => {
      lastfmConfigRef.current = cfg;
      await saveLastfmConfig(cfg);
    },
    connectLastfm: () => lastfm.connect(),
    disconnectLastfm: () => lastfm.disconnect(),
    setLastfmSecret: (secret) => saveSecret(secret),
    radio: radioSnapshot,
    startRadio,
    stopRadio,
  };
  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>;
}
