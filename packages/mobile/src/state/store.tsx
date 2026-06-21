import type { Library, PlaybackState, Server, Track } from "@musex/core";
import {
  advanceRadio,
  buildDownloadLookup,
  buildQueue,
  type DownloadJob,
  type DownloadOrigin,
  type DownloadRecord,
  discoverMusicLibraries,
  downloadKey,
  downloadRecordFor,
  estimateSyncBytes,
  PlaybackSession,
  PlayMonitor,
  pickDefaultLibrary,
  pickDefaultServer,
  type RadioState,
  radioKey,
  recordsToTracks,
  runLibrarySync,
  type StorageQuality,
  type SyncPorts,
  shouldTopUp,
} from "@musex/core";
import { Paths } from "expo-file-system";
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
import { AppState } from "react-native";
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
import { MobileCachingGateway } from "../cache/mobile-caching-gateway";
import { MobileListCache } from "../cache/mobile-list-cache";
import { ExpoListCacheFs } from "../cache/mobile-list-cache-fs";
import { sha256hex } from "../cache/sha256";
import { CLIENT_ID } from "../config-client-id";
import type { Connectivity } from "../downloads/connectivity-monitor";
import { ConnectivityMonitor } from "../downloads/connectivity-monitor";
import { DownloadIndex } from "../downloads/download-index";
import { DownloadManager } from "../downloads/download-manager";
import { DownloadStore } from "../downloads/download-store";
import { loadStorageQuality, saveStorageQuality } from "../downloads/storage-config";
import { loadSyncEnabled, saveSyncEnabled } from "../downloads/sync-config";
import { LastfmService } from "../lastfm/lastfm-service";
import { artUrl } from "../logic/art-url";
import { TasteService } from "../taste/taste-service";

function safeBaseUrl(gateway: MobileCachingGateway, serverId: string): string | null {
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
  gateway: MobileCachingGateway,
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
  gateway: MobileCachingGateway;
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
  // --- library sync (download-all mirror) ---
  /** Is "sync entire library to this device" on? */
  syncEnabled: boolean;
  /** Estimate the download + free space for the confirm dialog (null if unavailable/offline). */
  estimateSync: () => Promise<{ bytes: number; freeBytes: number; trackCount: number } | null>;
  /** Turn library sync on (starts a reconcile) or off (deletes sync-origin downloads). */
  setSyncEnabled: (enabled: boolean) => Promise<void>;
  connectivity: Connectivity;
  /** Clear the persisted list cache (called on sign-out). */
  clearListCache: () => Promise<void>;
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
  // Always-current connectivity, read synchronously by the caching gateway's
  // isOnline() so list fetches serve-stale (offline) without a stale closure.
  const connectivityRef = useRef<Connectivity>("online");
  connectivityRef.current = state.connectivity;

  // Last.fm config held in memory; persisted on every change.
  const lastfmConfigRef = useRef<LastfmConfig>(DEFAULT_LASTFM_CONFIG);

  // List cache (expo-file-system) + the caching gateway wrapping the raw Plex
  // gateway. isOnline() reads the live connectivity ref so offline serves stale.
  const listCache = useMemo(() => new MobileListCache(new ExpoListCacheFs(), sha256hex), []);
  const gateway = useMemo(
    () =>
      new MobileCachingGateway(
        new PlexGatewayImpl(fetch, CLIENT_ID),
        listCache,
        () => connectivityRef.current === "online",
      ),
    [listCache],
  );
  const tokenStore = useMemo(() => new SecureTokenStore(), []);
  const engine = useMemo(() => new ExpoAudioEngine(), []);
  const taste = useMemo(() => new TasteService(), []);
  const monitor = useMemo(() => new PlayMonitor(), []);

  // --- download infrastructure ---
  const downloadStore = useMemo(() => new DownloadStore(), []);
  const downloadIndex = useMemo(() => new DownloadIndex(), []);
  const storageQualityRef = useRef<StorageQuality>({ mode: "aac", bitrateKbps: 256 });

  // Library-sync toggle. syncEnabledRef is read by the coordinator (sync, no
  // re-render); syncEnabled drives the Settings toggle. Kept in lockstep by
  // setSyncEnabledLocal. Declared here (before the bootstrap effect that loads it).
  const syncEnabledRef = useRef(false);
  const [syncEnabled, setSyncEnabledState] = useState(false);
  const setSyncEnabledLocal = useCallback((enabled: boolean) => {
    syncEnabledRef.current = enabled;
    setSyncEnabledState(enabled);
  }, []);

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

  // Bootstrap: init audio session, restore token, discover servers, load last.fm config,
  // load downloads index + reconcile, load storage quality, start connectivity monitor.
  useEffect(() => {
    let alive = true;
    (async () => {
      await engine.init();
      await taste.init();
      await listCache.init();
      // Load last.fm config + secret into the in-memory ref before the service is used.
      const [lfmCfg, storedQuality, storedSync] = await Promise.all([
        loadLastfmConfig(),
        loadStorageQuality(),
        loadSyncEnabled(),
      ]);
      lastfmConfigRef.current = lfmCfg;
      storageQualityRef.current = storedQuality;
      setSyncEnabledLocal(storedSync);
      // Load the download index and reconcile with what's actually on disk.
      await downloadIndex.load();
      await downloadIndex.reconcile(downloadStore.presentNonEmptyKeys());
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
    listCache,
    setSyncEnabledLocal,
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

  // --- download helpers ---

  /** Build a DownloadJob from a Track. `origin` tags whether this is a user pin
   *  ("manual", default) or the library-sync mirror ("sync"). */
  const buildJob = useCallback(
    (track: Track, origin: DownloadOrigin = "manual"): DownloadJob => ({
      key: downloadKey(track.serverId, track.media.partKey),
      serverId: track.serverId,
      plexPath: track.media.partKey,
      trackId: track.id,
      origin,
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
      await downloadManager.enqueue(tracks.map((t) => buildJob(t)));
    },
    [downloadManager, buildJob],
  );

  const downloadAlbum = useCallback(
    async (library: Library, albumId: string) => {
      const tok = tokenRef.current;
      if (!tok) return;
      // listTracks is a cached gateway call: offline + uncached rejects with
      // OfflineUnavailable. Abort the download gracefully rather than letting it escape.
      let tracks: Track[];
      try {
        tracks = await gateway.listTracks(library, albumId, tok);
      } catch {
        return;
      }
      await downloadManager.enqueue(tracks.map((t) => buildJob(t)));
    },
    [gateway, downloadManager, buildJob],
  );

  const downloadArtist = useCallback(
    async (library: Library, artistId: string) => {
      const tok = tokenRef.current;
      if (!tok) return;
      // See downloadAlbum: cached enumeration can throw offline — abort gracefully.
      let tracks: Track[];
      try {
        tracks = await gateway.listArtistTracks(artistId, library, tok);
      } catch {
        return;
      }
      await downloadManager.enqueue(tracks.map((t) => buildJob(t)));
    },
    [gateway, downloadManager, buildJob],
  );

  const removeDownload = useCallback(
    async (key: string) => {
      await downloadManager.removeDownload(key);
    },
    [downloadManager],
  );

  // The full-library track list, behind the cached gateway. Throws
  // OfflineUnavailable when offline + uncached — which runLibrarySync treats as
  // "don't reconcile" (never removes), so a Plex blip can't wipe the device.
  const fetchAllTracks = useCallback(async (): Promise<Track[]> => {
    const tok = tokenRef.current;
    const lib = libraryRef.current;
    if (!tok || !lib) throw new Error("not signed in");
    return gateway.listAllTracks(lib, "title", tok);
  }, [gateway]);

  const syncPorts = useMemo<SyncPorts>(
    () => ({
      isEnabled: () => syncEnabledRef.current,
      listAllTracks: fetchAllTracks,
      downloadedRecords: () => downloadIndex.all(),
      enqueue: (tracks) => downloadManager.enqueue(tracks.map((t) => buildJob(t, "sync"))),
      remove: (key) => downloadManager.removeDownload(key),
    }),
    [fetchAllTracks, downloadIndex, downloadManager, buildJob],
  );

  // One reconcile pass; serialized so overlapping triggers (foreground +
  // connectivity + library change) don't run concurrently.
  const syncInFlight = useRef<Promise<void> | null>(null);
  const runSync = useCallback(() => {
    if (!syncEnabledRef.current) return Promise.resolve();
    if (syncInFlight.current) return syncInFlight.current;
    const p = runLibrarySync(syncPorts)
      .catch((err) => {
        console.warn("[sync] reconcile failed", err);
      })
      .finally(() => {
        syncInFlight.current = null;
      });
    syncInFlight.current = p.then(() => undefined);
    return syncInFlight.current;
  }, [syncPorts]);

  const estimateSync = useCallback(async () => {
    let tracks: Track[];
    try {
      tracks = await fetchAllTracks();
    } catch {
      return null;
    }
    const bytes = estimateSyncBytes(tracks, storageQualityRef.current);
    return { bytes, freeBytes: Paths.availableDiskSpace, trackCount: tracks.length };
  }, [fetchAllTracks]);

  const setSyncEnabled = useCallback(
    async (enabled: boolean) => {
      setSyncEnabledLocal(enabled);
      await saveSyncEnabled(enabled);
      if (enabled) {
        await runSync();
      } else {
        // Delete only sync-origin downloads; manual pins stay.
        const syncKeys = downloadIndex
          .all()
          .filter((r) => r.origin === "sync")
          .map((r) => r.key);
        await Promise.allSettled(syncKeys.map((k) => downloadManager.removeDownload(k)));
      }
    },
    [setSyncEnabledLocal, runSync, downloadIndex, downloadManager],
  );

  // Sync triggers. runLibrarySync no-ops when disabled, so these stay cheap when
  // sync is off. Fires on: launch + library change + regained connectivity (this
  // effect), and app foreground (the AppState effect below). enable triggers a
  // reconcile directly in setSyncEnabled. No background work, no timers.
  // biome-ignore lint/correctness/useExhaustiveDependencies: library id is a deliberate trigger (re-sync when the selected library changes), not used in the body.
  useEffect(() => {
    if (state.connectivity === "online") void runSync();
  }, [state.connectivity, state.library?.id, runSync]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") void runSync();
    });
    return () => sub.remove();
  }, [runSync]);

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
    syncEnabled,
    estimateSync,
    setSyncEnabled,
    connectivity: state.connectivity,
    clearListCache: () => listCache.clear(),
  };
  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>;
}
