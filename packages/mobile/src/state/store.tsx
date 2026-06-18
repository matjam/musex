import type { Library, PlaybackState, Server, Track } from "@musex/core";
import {
  advanceRadio,
  buildDownloadLookup,
  buildQueue,
  type DownloadJob,
  type DownloadRecord,
  discoverMusicLibraries,
  downloadKey,
  downloadRecordFor,
  PlaybackSession,
  PlayMonitor,
  pickDefaultLibrary,
  pickDefaultServer,
  type RadioState,
  radioKey,
  recentlyPlayedTracks,
  recordsToTracks,
  type StorageQuality,
  shouldTopUp,
} from "@musex/core";
import type { TrackInfo } from "@musex/plugin-api";
import { ProviderHub } from "@musex/plugin-host";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import * as WebBrowser from "expo-web-browser";
import { sha256 } from "js-sha256";
import {
  createContext,
  createElement,
  Fragment,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { Alert, Linking } from "react-native";
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
import type { Connectivity } from "../downloads/connectivity-monitor";
import { ConnectivityMonitor } from "../downloads/connectivity-monitor";
import { DownloadIndex } from "../downloads/download-index";
import { DownloadManager } from "../downloads/download-manager";
import { DownloadStore } from "../downloads/download-store";
import { loadStorageQuality, saveStorageQuality } from "../downloads/storage-config";
import { LastfmService } from "../lastfm/lastfm-service";
import { artUrl } from "../logic/art-url";
import { makeHostCallHandler } from "../plugins/host-capabilities";
import { PluginIndex } from "../plugins/plugin-index";
import { type FetchManifestResult, MobilePluginInstaller } from "../plugins/plugin-installer";
import { type PluginListItem, PluginManager } from "../plugins/plugin-manager";
import { PluginFileStore } from "../plugins/plugin-store";
import { expoFsOps } from "../plugins/plugin-store-fs";
import { type SandboxController, SandboxHostView } from "../plugins/sandbox-host";
import { TasteService } from "../taste/taste-service";

/** Map a mobile Track → the plugin-facing TrackInfo (no ids/URLs/tokens). */
function toTrackInfo(t: Track): TrackInfo {
  return {
    title: t.title,
    artistName: t.artistName,
    durationMs: t.durationMs,
    ...(t.albumTitle !== undefined ? { albumTitle: t.albumTitle } : {}),
    ...(t.trackNumber !== undefined ? { trackNumber: t.trackNumber } : {}),
  };
}

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
  connectivity: Connectivity;
}

type Action =
  | { type: "bootstrapped"; token: string | null }
  | { type: "signed-in"; token: string; servers: Server[]; library: Library | null }
  | { type: "library-selected"; library: Library }
  | { type: "signed-out" }
  | { type: "playback"; state: PlaybackState }
  | { type: "connectivity"; connectivity: Connectivity };

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
    case "connectivity":
      return { ...state, connectivity: action.connectivity };
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
  // --- downloads ---
  downloadTracks: (tracks: Track[]) => Promise<void>;
  downloadAlbum: (library: Library, albumId: string) => Promise<void>;
  downloadArtist: (library: Library, artistId: string) => Promise<void>;
  removeDownload: (key: string) => Promise<void>;
  /** Reconstruct playable Tracks from downloaded records with re-baked art URLs. */
  downloadedTracks: () => Track[];
  downloadsList: () => DownloadRecord[];
  getStorageQuality: () => StorageQuality;
  setStorageQuality: (q: StorageQuality) => Promise<void>;
  totalDownloadBytes: () => number;
  connectivity: Connectivity;
  /** Rate a track (Plex + taste + last.fm love + plugin trackRated event). */
  rateTrack: (track: Track, rating10: number | null) => Promise<void>;
  // --- plugins ---
  hub: ProviderHub;
  plugins: {
    list: () => PluginListItem[];
    install: (repoUrl: string, id: string) => Promise<void>;
    fetchManifest: (repoUrl: string) => Promise<FetchManifestResult>;
    uninstall: (id: string) => Promise<void>;
    setEnabled: (id: string, v: boolean) => Promise<void>;
    reload: () => Promise<void>;
  };
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
    connectivity: "online" as Connectivity,
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

  // --- download infrastructure ---
  const downloadStore = useMemo(() => new DownloadStore(), []);
  const downloadIndex = useMemo(() => new DownloadIndex(), []);
  const storageQualityRef = useRef<StorageQuality>({ mode: "original", bitrateKbps: 256 });

  const downloadManager = useMemo(
    () =>
      new DownloadManager({
        store: downloadStore,
        index: downloadIndex,
        fetch,
        endpoint: async (serverId: string) => ({
          baseUrl: gateway.baseUrlFor(serverId),
          token: tokenRef.current ?? "",
        }),
        clientId: CLIENT_ID,
        getQuality: () => storageQualityRef.current,
        onProgress: () => {
          // Progress updates trigger no state change here; UI polls downloadsList().
        },
      }),
    [downloadStore, downloadIndex, gateway],
  );

  // Ref so the connectivity probe always sees the current library without
  // causing the monitor to be reconstructed on every library change.
  const libraryRef = useRef<Library | null>(null);
  libraryRef.current = state.library;

  const connectivityMonitor = useMemo(() => {
    const NetInfo = require("@react-native-community/netinfo") as {
      addEventListener: (cb: (state: { isConnected: boolean | null }) => void) => () => void;
    };
    return new ConnectivityMonitor({
      subscribe: (cb) => NetInfo.addEventListener(cb),
      probe: async () => {
        const tok = tokenRef.current;
        const lib = libraryRef.current;
        if (!lib || !tok) return; // not signed in — treat as online
        await gateway.probe(lib.serverId, tok);
      },
      onChange: (c) => dispatch({ type: "connectivity", connectivity: c }),
    });
  }, [gateway]);

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

  // --- plugin system ---
  // The ProviderHub (registry + fan-out) lives RN-side; the WebView harness
  // runs each plugin in its own QuickJS context. Built once and stable for the
  // app lifetime.
  const hub = useMemo(() => new ProviderHub(), []);
  const pluginIndex = useMemo(() => new PluginIndex(), []);
  const pluginStore = useMemo(() => new PluginFileStore(expoFsOps), []);
  // The SandboxController arrives asynchronously once the WebView harness has
  // booted (WASM init). Held in a ref; loadAll is gated on it AND the index.
  const sandboxControllerRef = useRef<SandboxController | null>(null);
  const sandboxReadyRef = useRef(false);
  const pluginIndexLoadedRef = useRef(false);
  const pluginManagerRef = useRef<PluginManager | null>(null);

  const pluginInstaller = useMemo(
    () =>
      new MobilePluginInstaller({
        fetch,
        store: pluginStore,
        index: pluginIndex,
        sha256: (b) => sha256(b),
        reload: async () => {
          await pluginManagerRef.current?.reloadAll();
        },
      }),
    [pluginStore, pluginIndex],
  );

  // SecureStore keys allow only [A-Za-z0-9._-]; the namespaced secret keys use
  // ':' separators, so sanitize before hitting the store.
  const secretStoreKey = useCallback((k: string) => k.replace(/[^A-Za-z0-9._-]/g, "_"), []);

  // The host-call handler the WebView routes capability calls to. Built once
  // (app-lifetime-stable) so the SandboxHostView's useMemo can hold it forever.
  const hostCallHandler = useMemo(
    () =>
      makeHostCallHandler({
        storageGet: (key) => AsyncStorage.getItem(key),
        storageSet: async (key, value) => {
          if (value === null) await AsyncStorage.removeItem(key);
          else await AsyncStorage.setItem(key, value);
        },
        secretsGet: (key) => SecureStore.getItemAsync(secretStoreKey(key)),
        secretsSet: async (key, value) => {
          if (value === null) await SecureStore.deleteItemAsync(secretStoreKey(key));
          else await SecureStore.setItemAsync(secretStoreKey(key), value);
        },
        netFetch: async (url, init) => {
          const res = await fetch(url, {
            ...(init?.method ? { method: init.method } : {}),
            ...(init?.headers ? { headers: init.headers } : {}),
            ...(init?.body !== undefined ? { body: init.body } : {}),
          });
          const headers: Record<string, string> = {};
          res.headers.forEach((v, k) => {
            headers[k] = v;
          });
          return { ok: res.ok, status: res.status, headers, body: await res.text() };
        },
        library: {
          search: async (query) => {
            const lib = libraryRef.current;
            const tok = tokenRef.current;
            if (!lib || !tok) return { artists: [], albums: [], tracks: [] };
            const r = await gateway.search(lib, query, tok);
            return {
              artists: r.artists.map((a) => ({ id: a.id, name: a.name })),
              albums: r.albums.map((a) => ({
                id: a.id,
                title: a.title,
                // The mobile Album model carries artistId, not artist name.
                artistName: "",
              })),
              tracks: r.tracks.map(toTrackInfo),
            };
          },
          recentlyPlayed: async (limit) => {
            const lib = libraryRef.current;
            const tok = tokenRef.current;
            if (!lib || !tok) return [];
            const all = await gateway.listAllTracks(lib, "artist", tok);
            const stats = taste
              .snapshot()
              .trackStats.map((s) => ({ key: s.key, lastPlayedMs: s.lastPlayedMs }));
            return recentlyPlayedTracks(stats, all, limit ?? 20).map(toTrackInfo);
          },
          topArtists: async (limit) => {
            const top = taste.snapshot().topArtists;
            return limit ? top.slice(0, limit) : top;
          },
        },
        notify: (payload) => {
          Alert.alert(payload.pluginId, payload.message);
        },
        openExternal: (url) => {
          void Linking.openURL(url);
        },
        log: (pluginId, message, args) => {
          console.log(`[plugin ${pluginId}]`, message, ...args);
        },
        registerSettings: () => {
          // Declarative plugin settings UI is not surfaced on mobile yet.
        },
      }),
    [gateway, taste, secretStoreKey],
  );

  const pluginManager = useMemo(() => {
    const mgr = new PluginManager({
      index: pluginIndex,
      store: pluginStore,
      // A lazy proxy: the real controller arrives via onController. The manager
      // is only driven (loadAll) after the controller exists, so these forward.
      sandbox: {
        load: (id, manifest, code) => {
          const c = sandboxControllerRef.current;
          if (!c) throw new Error("plugin sandbox not ready");
          return c.load(id, manifest, code);
        },
        invoke: (id, path, method, args) => {
          const c = sandboxControllerRef.current;
          if (!c) return Promise.reject(new Error("plugin sandbox not ready"));
          return c.invoke(id, path, method, args);
        },
        emit: (id, event, payload) => sandboxControllerRef.current?.emit(id, event, payload),
        dispose: (id) => sandboxControllerRef.current?.dispose(id),
        ready: Promise.resolve(),
      },
      hub,
    });
    pluginManagerRef.current = mgr;
    return mgr;
  }, [pluginIndex, pluginStore, hub]);

  // Gate plugin activation on BOTH the WebView harness being ready AND the
  // installed index being loaded. Either side may complete first.
  const maybeLoadPlugins = useCallback(() => {
    if (sandboxReadyRef.current && pluginIndexLoadedRef.current) {
      void pluginManager.loadAll();
    }
  }, [pluginManager]);

  const onSandboxController = useCallback((c: SandboxController) => {
    sandboxControllerRef.current = c;
  }, []);
  const onSandboxReady = useCallback(() => {
    sandboxReadyRef.current = true;
    maybeLoadPlugins();
  }, [maybeLoadPlugins]);

  // The plugins facade exposed on the Store (delegates to manager + installer).
  const plugins = useMemo(
    () => ({
      list: (): PluginListItem[] => pluginManager.list(),
      install: (repoUrl: string, id: string): Promise<void> => pluginInstaller.install(repoUrl, id),
      fetchManifest: (repoUrl: string): Promise<FetchManifestResult> =>
        pluginInstaller.fetchManifest(repoUrl),
      uninstall: (id: string): Promise<void> => pluginInstaller.uninstall(id),
      setEnabled: (id: string, v: boolean): Promise<void> => pluginManager.setEnabled(id, v),
      reload: (): Promise<void> => pluginManager.reloadAll(),
    }),
    [pluginManager, pluginInstaller],
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
      (track) => {
        const rec = downloadRecordFor(buildDownloadLookup(downloadIndex.all()), track);
        return rec ? downloadStore.uri(rec.key) : null;
      },
    );
    return new PlaybackSession(engine, resolver);
  }, [engine, gateway, downloadIndex, downloadStore]);

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
  // Plugin-event derivation: previous status (for paused/resumed), the last
  // observed position of the current track (for trackEnded.playedSec), and the
  // Track whose play-through is in progress (for trackEnded.durationMs — the
  // CompletedPlay from PlayMonitor carries only title/artist, and it fires for
  // the OLD track within the same onState call that swaps to the new one, so
  // this ref still holds the just-ended track at that point).
  const prevStatusRef = useRef<PlaybackState["status"]>("idle");
  const lastPositionRef = useRef<number>(0);
  const currentTrackRef = useRef<Track | null>(null);
  useEffect(
    () =>
      session.subscribe((s) => {
        const completed = monitor.onState(s);
        if (completed) {
          taste.recordPlay(
            { title: completed.title, artistName: completed.artistName },
            completed.kind,
          );
          // Plugin trackEnded for the track that just finished, with the last
          // observed playback position as playedSec; scrobble fires the curated
          // event when the gate passed (kind === "full"), matching desktop.
          // durationMs comes from the just-ended track (currentTrackRef, not yet
          // swapped this tick) when the title matches, else 0.
          const ended = currentTrackRef.current;
          const endedInfo: TrackInfo = {
            title: completed.title,
            artistName: completed.artistName,
            durationMs: ended && ended.title === completed.title ? ended.durationMs : 0,
          };
          pluginManager.emitEvent("trackEnded", {
            track: endedInfo,
            playedSec: lastPositionRef.current,
          });
          if (completed.kind === "full") {
            const startedAtEpochSec = Math.floor(startedAtRef.current / 1000);
            void lastfm.scrobble(
              { artistName: completed.artistName, title: completed.title },
              startedAtRef.current,
            );
            pluginManager.emitEvent("scrobble", { track: endedInfo, startedAtEpochSec });
          }
        }
        dispatch({ type: "playback", state: s });
        // Track current position so trackEnded carries an accurate playedSec.
        if (s.status === "playing" || s.status === "paused") {
          lastPositionRef.current = s.positionSec;
        }
        const cur = s.queue ? s.queue.tracks[s.queue.index] : undefined;
        // paused/resumed transitions for the current track (no track change).
        if (cur && s.status !== prevStatusRef.current) {
          if (s.status === "paused" && prevStatusRef.current === "playing") {
            pluginManager.emitEvent("paused", { track: toTrackInfo(cur) });
          } else if (s.status === "playing" && prevStatusRef.current === "paused") {
            pluginManager.emitEvent("resumed", { track: toTrackInfo(cur) });
          }
        }
        prevStatusRef.current = s.status;
        if (cur && cur.id !== lastTrackId.current) {
          lastTrackId.current = cur.id;
          currentTrackRef.current = cur;
          startedAtRef.current = Date.now();
          lastPositionRef.current = 0;
          pluginManager.emitEvent("trackStarted", {
            track: toTrackInfo(cur),
            startedAtEpochSec: Math.floor(Date.now() / 1000),
          });
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
    [session, engine, gateway, taste, monitor, lastfm, doTopUp, pluginManager],
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

  // Bootstrap: init audio session, restore token, discover servers, load last.fm config,
  // load downloads index + reconcile, load storage quality, start connectivity monitor.
  useEffect(() => {
    let alive = true;
    (async () => {
      await engine.init();
      await taste.init();
      // Load last.fm config + secret into the in-memory ref before the service is used.
      const [lfmCfg, storedQuality] = await Promise.all([loadLastfmConfig(), loadStorageQuality()]);
      lastfmConfigRef.current = lfmCfg;
      storageQualityRef.current = storedQuality;
      // Load the download index and reconcile with what's actually on disk.
      await downloadIndex.load();
      await downloadIndex.reconcile(downloadStore.presentNonEmptyKeys());
      // Load the installed-plugin index; activation is gated on the WebView
      // harness also being ready (maybeLoadPlugins fires when both are true).
      await pluginIndex.load();
      pluginIndexLoadedRef.current = true;
      maybeLoadPlugins();
      // Start the connectivity monitor (polls netinfo + probe on change).
      connectivityMonitor.start();
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
      connectivityMonitor.stop();
    };
  }, [
    engine,
    tokenStore,
    taste,
    completeSignIn,
    downloadIndex,
    downloadStore,
    connectivityMonitor,
    pluginIndex,
    maybeLoadPlugins,
  ]);

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

  // Rate a track: persist to Plex, record into the taste profile, apply
  // love-on-rating, and fire the plugin `trackRated` event. Centralized here so
  // the rating side-effects (incl. the plugin event) live in one place.
  const rateTrack = useCallback(
    async (track: Track, rating10: number | null): Promise<void> => {
      await gateway.rateItem(track.serverId, track.id, rating10, tokenRef.current ?? "");
      taste.recordTrackRating({ title: track.title, artistName: track.artistName }, rating10);
      if (lastfmConfigRef.current.loveOnRating) {
        const t = { artistName: track.artistName, title: track.title };
        if (rating10 !== null && rating10 >= 8) void lastfm.love(t);
        else void lastfm.unlove(t);
      }
      pluginManager.emitEvent("trackRated", { track: toTrackInfo(track), rating10 });
    },
    [gateway, taste, lastfm, pluginManager],
  );

  // --- download helpers ---

  /** Build a DownloadJob from a Track. */
  const buildJob = useCallback(
    (track: Track): DownloadJob => ({
      key: downloadKey(track.serverId, track.media.partKey),
      serverId: track.serverId,
      plexPath: track.media.partKey,
      trackId: track.id,
      meta: {
        title: track.title,
        artistName: track.artistName,
        albumTitle: track.albumTitle,
        durationMs: track.durationMs,
        thumb: track.thumb,
        trackNumber: track.trackNumber,
        albumId: track.albumId ?? "",
        artistId: track.artistId ?? "",
        container: track.media.container,
        audioCodec: track.media.audioCodec,
        partId: track.media.partId,
        bitrate: track.media.bitrate,
      },
    }),
    [],
  );

  const downloadTracks = useCallback(
    async (tracks: Track[]) => {
      await downloadManager.enqueue(tracks.map(buildJob));
    },
    [downloadManager, buildJob],
  );

  const downloadAlbum = useCallback(
    async (library: Library, albumId: string) => {
      const tok = tokenRef.current;
      if (!tok) return;
      const tracks = await gateway.listTracks(library, albumId, tok);
      await downloadManager.enqueue(tracks.map(buildJob));
    },
    [gateway, downloadManager, buildJob],
  );

  const downloadArtist = useCallback(
    async (library: Library, artistId: string) => {
      const tok = tokenRef.current;
      if (!tok) return;
      const tracks = await gateway.listArtistTracks(artistId, library, tok);
      await downloadManager.enqueue(tracks.map(buildJob));
    },
    [gateway, downloadManager, buildJob],
  );

  const removeDownload = useCallback(
    async (key: string) => {
      await downloadManager.removeDownload(key);
    },
    [downloadManager],
  );

  /** Reconstruct playable Tracks from downloaded records, re-baking art URLs
   *  with the current server base URL and token so stale baked proxy URLs from
   *  previous launches are refreshed. */
  const downloadedTracks = useCallback((): Track[] => {
    const tok = tokenRef.current;
    return recordsToTracks(downloadIndex.all()).map((track) => {
      if (!tok) return track;
      const base = safeBaseUrl(gateway, track.serverId);
      if (!base || !track.thumb) return track;
      // Re-bake: strip any existing URL (baked or raw plex path) and rebuild.
      // The thumb stored in the record may already be a full baked URL
      // (previous-launch format) or a raw plex path (/library/metadata/.../thumb).
      // artUrl() works for both: a raw path → base+path+token; a full URL passed
      // as-is would produce a double URL, so we always strip to the raw path first.
      let rawThumb = track.thumb;
      if (rawThumb.startsWith("http")) {
        // Extract the plex path from the full URL by finding the path portion.
        try {
          rawThumb = new URL(rawThumb).pathname;
        } catch {
          // leave as-is
        }
      }
      return { ...track, thumb: artUrl(base, rawThumb, tok) ?? track.thumb };
    });
  }, [downloadIndex, gateway]);

  const getStorageQuality = useCallback((): StorageQuality => storageQualityRef.current, []);

  const setStorageQuality = useCallback(async (q: StorageQuality) => {
    storageQualityRef.current = q;
    await saveStorageQuality(q);
  }, []);

  const totalDownloadBytes = useCallback(() => downloadStore.totalBytes(), [downloadStore]);

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
    downloadTracks,
    downloadAlbum,
    downloadArtist,
    removeDownload,
    downloadedTracks,
    downloadsList: () => downloadIndex.all(),
    getStorageQuality,
    setStorageQuality,
    totalDownloadBytes,
    connectivity: state.connectivity,
    rateTrack,
    hub,
    plugins,
  };
  return createElement(
    Fragment,
    null,
    createElement(StoreCtx.Provider, { value }, children),
    // Hidden WebView host that runs plugins in their QuickJS sandbox. It posts
    // host-capability calls back through hostCallHandler and surfaces the
    // controller (load/invoke/emit/dispose) once the harness has booted.
    createElement(SandboxHostView, {
      hostCallHandler,
      onController: onSandboxController,
      onReady: onSandboxReady,
    }),
  );
}
