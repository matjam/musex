import {
  buildQueue,
  PlaybackSession,
  type PlaybackState,
  type RepeatMode,
  type Track,
} from "@musex/core";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import { IpcStreamResolver } from "../audio/ipc-stream-resolver";
import { WebPlaybackEngine } from "../audio/playback-engine";

interface PlayerApi {
  state: PlaybackState;
  playTracks(tracks: Track[], startIndex: number): void;
  togglePlay(): void;
  next(): void;
  previous(): void;
  seek(sec: number): void;
  setVolume(v: number): void;
  enqueueNext(tracks: Track[]): void;
  enqueueEnd(tracks: Track[]): void;
  removeFromQueue(index: number): void;
  moveInQueue(from: number, to: number): void;
  clearQueue(): void;
  toggleShuffle(): void;
  cycleRepeat(): void;
  jumpTo(index: number): void;
}

const Ctx = createContext<PlayerApi | null>(null);

export function PlayerProvider({ children }: { children: ReactNode }) {
  const session = useMemo(
    () => new PlaybackSession(new WebPlaybackEngine(), new IpcStreamResolver()),
    [],
  );
  const stateRef = useRef(session.getState());

  // Refs let the save effects skip re-persisting the just-restored state.
  const savedTracksRef = useRef<Track[] | null>(null);
  const savedCursorRef = useRef<{ index: number; shuffle: boolean; repeat: RepeatMode } | null>(
    null,
  );
  const restoredRef = useRef(false);

  const subscribe = useCallback(
    (cb: () => void) =>
      session.subscribe((s) => {
        stateRef.current = s;
        cb();
      }),
    [session],
  );

  const getSnapshot = useCallback(() => stateRef.current, []);

  const state = useSyncExternalStore(subscribe, getSnapshot);

  // Prefetch upcoming tracks into the cache whenever the upcoming set changes.
  // Keyed on upcomingKey (track ids joined) so this does NOT fire on position ticks.
  const PREFETCH_DEPTH = 10;
  const upcoming =
    state.queue != null
      ? state.queue.tracks.slice(state.queue.index + 1, state.queue.index + 1 + PREFETCH_DEPTH)
      : [];
  const upcomingKey = upcoming.map((t) => t.id).join(",");
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on upcomingKey
  useEffect(() => {
    void window.musex.prefetch(upcoming);
  }, [upcomingKey]);

  // Initialise volume from main-process store on mount
  useEffect(() => {
    window.musex.getVolume().then((v) => {
      session.setVolume(v);
    });
  }, [session]);

  // Restore persisted playback (queue + cursor + position) once on mount.
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    void (async () => {
      const saved = await window.musex.loadPlayback();
      if (!saved) return;
      savedTracksRef.current = saved.queue.tracks;
      savedCursorRef.current = {
        index: saved.queue.index,
        shuffle: saved.queue.shuffle,
        repeat: saved.queue.repeat,
      };
      await session.restore(saved.queue, saved.positionSec);
    })();
  }, [session]);

  // Persist the track list whenever it changes (reference compare distinguishes
  // a list change from a cursor-only move — the session reuses the array on moves).
  useEffect(() => {
    const q = state.queue;
    if (!q) return;
    if (q.tracks !== savedTracksRef.current) {
      savedTracksRef.current = q.tracks;
      void window.musex.savePlaybackQueue(q.tracks);
    }
  }, [state.queue]);

  // Persist the cursor: immediately on index/shuffle/repeat change, otherwise
  // throttled (~5s) so position-only ticks don't hammer the store.
  const lastCursorSaveRef = useRef(0);
  useEffect(() => {
    const q = state.queue;
    if (!q) return;
    const prev = savedCursorRef.current;
    const cursorChanged =
      prev == null ||
      q.index !== prev.index ||
      q.shuffle !== prev.shuffle ||
      q.repeat !== prev.repeat;
    const now = performance.now();
    if (!cursorChanged && now - lastCursorSaveRef.current < 5000) return;
    savedCursorRef.current = { index: q.index, shuffle: q.shuffle, repeat: q.repeat };
    lastCursorSaveRef.current = now;
    void window.musex.savePlaybackCursor({
      index: q.index,
      positionSec: state.positionSec,
      shuffle: q.shuffle,
      repeat: q.repeat,
    });
  }, [state.queue, state.positionSec]);

  const api: PlayerApi = {
    state,
    playTracks: (tracks, startIndex) => void session.loadQueue(buildQueue(tracks, startIndex)),
    togglePlay: () => (state.status === "playing" ? session.pause() : session.play()),
    next: () => void session.next(),
    previous: () => void session.previous(),
    seek: (sec) => session.seek(sec),
    setVolume: (v) => {
      session.setVolume(v);
      void window.musex.setVolume(v);
    },
    enqueueNext: (tracks) => void session.enqueueNext(tracks),
    enqueueEnd: (tracks) => void session.enqueueEnd(tracks),
    removeFromQueue: (index) => session.removeAt(index),
    moveInQueue: (from, to) => session.move(from, to),
    clearQueue: () => session.clearQueue(),
    toggleShuffle: () => session.setShuffle(!(state.queue?.shuffle ?? false)),
    cycleRepeat: () => session.cycleRepeat(),
    jumpTo: (index) => void session.jumpTo(index),
  };

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function usePlayer(): PlayerApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("usePlayer must be used within PlayerProvider");
  return v;
}
