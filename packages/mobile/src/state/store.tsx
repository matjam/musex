import type { Library, PlaybackState, Server, Track } from "@musex/core";
import {
  advanceRadio,
  buildDownloadLookup,
  buildQueue,
  type CacheConfig,
  type DownloadJob,
  type DownloadOrigin,
  type DownloadRecord,
  discoverMusicLibraries,
  downloadKey,
  downloadRecordFor,
  estimateSyncBytes,
  isInFlight,
  PlaybackSession,
  PlayMonitor,
  pickDefaultLibrary,
  pickDefaultServer,
  planCacheEviction,
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
import BackgroundDownloadsNative from "../../modules/background-downloads";
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
import { DEFAULT_CACHE_CONFIG, loadCacheConfig, saveCacheConfig } from "../downloads/cache-config";
import type { Connectivity } from "../downloads/connectivity-monitor";
import { ConnectivityMonitor } from "../downloads/connectivity-monitor";
import { DownloadIndex } from "../downloads/download-index";
import { DownloadManager } from "../downloads/download-manager";
import { DownloadStore } from "../downloads/download-store";
import { JsTransferEngine } from "../downloads/js-transfer-engine";
import { createNativeTransferEngine } from "../downloads/native-transfer-engine";
import { RoutingTransferEngine } from "../downloads/routing-transfer-engine";
import { loadStorageQuality, saveStorageQuality } from "../downloads/storage-config";
import { loadSyncEnabled, saveSyncEnabled } from "../downloads/sync-config";
import { LastfmService } from "../lastfm/lastfm-service";
import { artUrl } from "../logic/art-url";
import { TasteService } from "../taste/taste-service";

// Cache a track once it has played this long — a real listen, not a skip.
const CACHE_PLAY_THRESHOLD_SEC = 20;

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
  /** Increments as downloads progress — read it to re-render download-derived UI live. */
  downloadsVersion: number;
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
  // --- cache played tracks ---
  /** "Keep played tracks offline" config (toggle + size cap). */
  cacheConfig: CacheConfig;
  setCacheConfig: (config: CacheConfig) => Promise<void>;
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

  // Bumped (throttled) on every download progress event so the Downloaded list
  // and album "downloaded" badges re-render as tracks land — no polling, no
  // waiting for the whole sync to finish.
  const [downloadsVersion, setDownloadsVersion] = useState(0);
  const dlVersionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bumpDownloadsVersion = useCallback(() => {
    if (dlVersionTimer.current) return;
    dlVersionTimer.current = setTimeout(() => {
      dlVersionTimer.current = null;
      setDownloadsVersion((v) => v + 1);
    }, 400);
  }, []);

  // "Keep played tracks offline" config. cacheConfigRef is read on the hot play
  // path (no re-render); cacheConfig drives the Settings UI.
  const cacheConfigRef = useRef<CacheConfig>(DEFAULT_CACHE_CONFIG);
  const [cacheConfig, setCacheConfigState] = useState<CacheConfig>(DEFAULT_CACHE_CONFIG);
  // The cache-on-play handler is assigned later (it needs buildJob); the play
  // loop calls it through this ref so it stays out of that effect's deps.
  const cacheOnPlayRef = useRef<((s: PlaybackState) => void) | null>(null);

  // Route by mode when the native module is in the binary (dev-client /
  // production builds): Original jobs run on the native background engine
  // (durable backlog, survives suspend/kill); HLS/AAC jobs run on the JS
  // engine in the foreground — PMS reaps an unconsumed transcode session
  // ~1-2s after the transcoder finishes and 400s a same-client re-start, so
  // the native engine's seconds-apart chained tasks always 404'd at the
  // media playlist (see routing-transfer-engine.ts). Plain JS engine
  // otherwise (Expo Go, simulator without the module).
  const transferEngine = useMemo(() => {
    const js = new JsTransferEngine({ store: downloadStore, fetch });
    const native = createNativeTransferEngine(BackgroundDownloadsNative);
    return native ? new RoutingTransferEngine({ hls: js, original: native }) : js;
  }, [downloadStore]);

  const downloadManager = useMemo(
    () =>
      new DownloadManager({
        store: downloadStore,
        index: downloadIndex,
        engine: transferEngine,
        endpoint: async (serverId: string) => ({
          baseUrl: gateway.baseUrlFor(serverId),
          token: tokenRef.current ?? "",
        }),
        clientId: CLIENT_ID,
        getQuality: () => storageQualityRef.current,
        onProgress: (e) => {
          bumpDownloadsVersion();
          // When a cache track finishes, trim the cache to its cap (LRU). Uses
          // the store/index directly (the manager isn't constructed yet here).
          if (e.state === "downloaded") {
            for (const k of planCacheEviction(
              downloadIndex.all(),
              cacheConfigRef.current.capBytes,
            )) {
              downloadStore.remove(k);
              void downloadIndex.remove(k);
            }
          }
        },
      }),
    [downloadStore, downloadIndex, transferEngine, gateway, bumpDownloadsVersion],
  );

  // Ref so the connectivity probe always sees the current library without
  // causing the monitor to be reconstructed on every library change.
  const libraryRef = useRef<Library | null>(null);
  libraryRef.current = state.library;

  const connectivityMonitor = useMemo(() => {
    const NetInfo = require("@react-native-community/netinfo") as {
      addEventListener: (
        cb: (state: { isConnected: boolean | null; type: string }) => void,
      ) => () => void;
    };
    return new ConnectivityMonitor({
      subscribe: (cb) =>
        NetInfo.addEventListener((s) => cb({ isConnected: s.isConnected, type: s.type })),
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
        // Cache-on-play: save the current track once it's been listened to.
        cacheOnPlayRef.current?.(s);
        const cur = s.queue ? s.queue.tracks[s.queue.index] : undefined;
        if (cur && cur.id !== lastTrackId.current) {
          lastTrackId.current = cur.id;
          startedAtRef.current = Date.now();
          // Bump LRU recency for a cached copy of the track now playing.
          const ckey = downloadKey(cur.serverId, cur.media.partKey);
          const crec = downloadIndex.get(ckey);
          if (crec?.origin === "cache" && crec.state === "downloaded") {
            void downloadIndex.upsert({ ...crec, lastAccessMs: Date.now() });
          }
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
    [session, engine, gateway, taste, monitor, lastfm, doTopUp, downloadIndex],
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
      const [lfmCfg, storedQuality, storedSync, storedCache] = await Promise.all([
        loadLastfmConfig(),
        loadStorageQuality(),
        loadSyncEnabled(),
        loadCacheConfig(),
      ]);
      lastfmConfigRef.current = lfmCfg;
      storageQualityRef.current = storedQuality;
      setSyncEnabledLocal(storedSync);
      cacheConfigRef.current = storedCache;
      setCacheConfigState(storedCache);
      // Load the download index and reconcile with what's actually on disk —
      // size-verified: a downloaded record whose file doesn't match its
      // committed expectedBytes is demoted to missing (size verification
      // applies to records committed under v2+; pre-v2 records have no
      // expectedBytes, so presence remains their only check).
      await downloadIndex.load();
      // Fold the engine's while-JS-was-away results into the index BEFORE the
      // disk passes (native engine only — the JS engine's snapshot is always
      // empty): completed transfers become downloaded records carrying the
      // DELIVERED size (verified present below), failures become failed
      // records, and still-active keys are (a) protected from the stale-in-
      // flight resolve and (b) given a direct event->record mapping, since no
      // manager loop owns them this session (their jobs were submitted by a
      // previous run and live in the native backlog).
      const snap = await transferEngine.reattach();
      const fileSizes = downloadStore.presentFileSizes();
      const presentKeys = new Set(fileSizes.keys());
      for (const c of snap.completed) {
        const r = downloadIndex.get(c.key);
        if (!r) {
          // Orphan: Swift moved a finished file into place for a key JS no
          // longer tracks (removed while the transfer completed in the
          // background). Without cleanup the file would linger forever.
          downloadStore.remove(c.key);
          continue;
        }
        // File absent → leave the record; reconcile/resolve below handles it.
        if (presentKeys.has(c.key)) {
          await downloadIndex.upsert({
            ...r,
            state: "downloaded",
            bytes: c.bytes,
            expectedBytes: c.bytes,
            error: undefined,
          });
        }
      }
      for (const f of snap.failed) {
        // "cancelled" is bookkeeping-only: the JS side that cancelled it
        // already removed (or re-created) the record — same rule as the
        // manager's live event mapping.
        if (f.message === "cancelled") continue;
        const r = downloadIndex.get(f.key);
        if (r && isInFlight(r)) {
          await downloadIndex.upsert({ ...r, state: "failed", bytes: 0, error: f.message });
        }
      }
      const nativeActiveKeys = new Set(snap.active);
      // Corrupt = a still-`downloaded` record whose PRESENT file mismatches its
      // committed size. Computed BEFORE reconcile so a record already `missing`
      // from a prior session (with a present file) is left alone — exactly the
      // demoted-this-boot files get deleted, nothing else.
      const corruptKeys = downloadIndex
        .all()
        .filter(
          (r) =>
            r.state === "downloaded" &&
            r.expectedBytes !== undefined &&
            fileSizes.get(r.key) !== undefined &&
            fileSizes.get(r.key) !== r.expectedBytes,
        )
        .map((r) => r.key);
      await downloadIndex.reconcile(presentKeys, fileSizes);
      for (const k of corruptKeys) downloadStore.remove(k);
      // Resume an interrupted sync: records stuck "queued"/"downloading" from a
      // previous launch are resolved against disk, size-gated (a matching file
      // promotes to downloaded; a mismatched partial is dropped and its file
      // deleted; absent is dropped so the next sync re-queues it) — never
      // re-download a finished track, never trust a half-committed one. Keys
      // the native engine reports as active are genuinely still downloading —
      // they're NOT stale and are left alone.
      for (const k of downloadIndex.resolveStaleInFlight(fileSizes, nativeActiveKeys)) {
        downloadStore.remove(k);
      }
      // The manager's persistent engine subscription owns event→record
      // mapping from here on — for its own submissions AND the reattached-
      // active keys (it patches any record it has no entry for). It buffered
      // events while we folded; release them now that the index is settled.
      downloadManager.markReady();
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
      downloadManager.dispose();
      connectivityMonitor.stop();
    };
  }, [
    engine,
    tokenStore,
    taste,
    completeSignIn,
    downloadIndex,
    downloadStore,
    downloadManager,
    transferEngine,
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
      // Integrity truth for Original downloads (AAC ignores it — no
      // predetermined transcode size).
      expectedBytes: track.media.sizeBytes,
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

  // Cache-on-play: once the current track has played past the threshold, enqueue
  // it as a cache-origin download (deduped). Skips when disabled, offline, or the
  // track is already downloaded/queued. Wired into the play loop via cacheOnPlayRef.
  const maybeCacheCurrent = useCallback(
    (s: PlaybackState) => {
      if (!cacheConfigRef.current.enabled) return;
      if (connectivityRef.current !== "online") return;
      if (s.positionSec < CACHE_PLAY_THRESHOLD_SEC) return;
      const cur = s.queue ? s.queue.tracks[s.queue.index] : undefined;
      if (!cur) return;
      const key = downloadKey(cur.serverId, cur.media.partKey);
      const existing = downloadIndex.get(key);
      if (existing && existing.state !== "failed" && existing.state !== "missing") return;
      void downloadManager.enqueue([buildJob(cur, "cache")]);
    },
    [downloadIndex, downloadManager, buildJob],
  );
  useEffect(() => {
    cacheOnPlayRef.current = maybeCacheCurrent;
  }, [maybeCacheCurrent]);

  const setCacheConfig = useCallback(
    async (config: CacheConfig) => {
      cacheConfigRef.current = config;
      setCacheConfigState(config);
      await saveCacheConfig(config);
      // Apply a tightened cap right away (disabling does NOT delete existing
      // cache — it just stops adding; the cap still bounds it).
      for (const k of planCacheEviction(downloadIndex.all(), config.capBytes)) {
        downloadStore.remove(k);
        void downloadIndex.remove(k);
      }
    },
    [downloadIndex, downloadStore],
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
      // Leaving the foreground: flush any debounced index write so progress isn't
      // lost if iOS suspends/kills the app.
      else void downloadIndex.flush();
    });
    return () => sub.remove();
  }, [runSync, downloadIndex]);

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

  // Stable identity: the provider value is rebuilt per render, so an inline
  // closure here would defeat every useMemo keyed on it (recompute per render
  // instead of per downloadsVersion bump).
  const downloadsList = useCallback(() => downloadIndex.all(), [downloadIndex]);

  const getStorageQuality = useCallback((): StorageQuality => storageQualityRef.current, []);

  const setStorageQuality = useCallback(
    async (q: StorageQuality) => {
      storageQualityRef.current = q;
      await saveStorageQuality(q);
      // Still-queued jobs pinned the OLD mode at enqueue (and, natively, carry
      // old-mode URLs) — cancel and re-enqueue them so their transfers match
      // the new mode. A record mid-download finishes in its old mode
      // (accepted). Note: a re-enqueued job rebuilt from an AAC record has no
      // catalog expectedBytes, so an aac→original switch loses the truncation
      // guard for those jobs (pre-v2 semantics; the delivered size still
      // becomes the record's truth on commit).
      const queued = downloadIndex.all().filter((r) => r.state === "queued");
      if (queued.length === 0) return;
      const keys = queued.map((r) => r.key);
      // cancelQueued drops the manager's own entries first, then cancels the
      // keys on the engine backlog. The engine's terminal "cancelled" events
      // are bookkeeping-only in the manager's mapping (ignored when a record
      // exists), so the re-enqueued records below can't be marked failed by a
      // stale cancel event racing them.
      await downloadManager.cancelQueued(keys);
      for (const k of keys) await downloadIndex.remove(k);
      await downloadManager.enqueue(
        queued.map((r) => ({
          key: r.key,
          serverId: r.serverId,
          plexPath: r.plexPath,
          trackId: r.trackId,
          origin: r.origin,
          expectedBytes: r.expectedBytes,
          meta: r.meta,
        })),
      );
    },
    [downloadIndex, downloadManager],
  );

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
    downloadsList,
    downloadsVersion,
    getStorageQuality,
    setStorageQuality,
    totalDownloadBytes,
    syncEnabled,
    estimateSync,
    setSyncEnabled,
    cacheConfig,
    setCacheConfig,
    connectivity: state.connectivity,
    clearListCache: () => listCache.clear(),
  };
  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>;
}
