import { buildQueue, PlaybackSession, type PlaybackState, type Track } from "@musex/core";
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

  // Initialise volume from main-process store on mount
  useEffect(() => {
    window.musex.getVolume().then((v) => {
      session.setVolume(v);
    });
  }, [session]);

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
