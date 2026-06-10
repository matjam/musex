import {
  buildQueue,
  carryRepeat,
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
  useState,
  useSyncExternalStore,
} from "react";
import type { TrackInfo } from "../../../shared/ipc-contract";
import { IpcPlaybackEngine } from "../audio/ipc-playback-engine";
import { IpcStreamResolver } from "../audio/ipc-stream-resolver";

/** Strip a track down to what plugins are allowed to see — title/artist/album/
 *  duration/track number only. NO ids, URLs, or thumbs cross this boundary. */
export function toTrackInfo(t: Track): TrackInfo {
  return {
    title: t.title,
    artistName: t.artistName,
    albumTitle: t.albumTitle,
    durationMs: t.durationMs,
    trackNumber: t.trackNumber,
  };
}

interface PlayerApi {
  state: PlaybackState;
  playTracks(tracks: Track[], startIndex: number): void;
  /** Replace the queue with these tracks shuffled and play (shuffle on). */
  playTracksShuffled(tracks: Track[]): void;
  /** Play one track now (inserted after current), preserving shuffle/repeat. */
  playTrackNext(track: Track): void;
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
  /** True while radio mode is armed (queue auto-extends from recommenders). */
  radioActive: boolean;
  /** Play the track now (unless already current) and arm radio seeded by it. */
  startRadioFromTrack(track: Track): void;
  /** Arm radio seeded by an artist; the current queue keeps playing and
   *  appending begins on the next low-water check. */
  startRadioFromArtist(artistName: string): void;
  stopRadio(): void;
}

const Ctx = createContext<PlayerApi | null>(null);

export function PlayerProvider({ children }: { children: ReactNode }) {
  const session = useMemo(
    () => new PlaybackSession(new IpcPlaybackEngine(), new IpcStreamResolver()),
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

  // Prefetch into the cache whenever the playing/upcoming set changes.
  // The CURRENT track goes first (priority: it's what's audibly playing, and
  // mpv streams with Range requests which the serve path never caches), then
  // the next PREFETCH_DEPTH tracks. Keyed on upcomingKey so this does NOT fire
  // on position ticks.
  const PREFETCH_DEPTH = 10;
  const upcoming =
    state.queue != null
      ? state.queue.tracks.slice(state.queue.index, state.queue.index + 1 + PREFETCH_DEPTH)
      : [];
  const upcomingKey = upcoming.map((t) => t.id).join(",");
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on upcomingKey
  useEffect(() => {
    void window.musex.prefetch(upcoming);
  }, [upcomingKey]);

  // ── Radio mode ─────────────────────────────────────────────────────────────
  // null = off. While armed, the effect below keeps the queue topped up from
  // the plugin recommenders whenever fewer than RADIO_LOW_WATER tracks remain.
  const [radio, setRadio] = useState<{
    seedTracks: { title: string; artist: string }[];
    seedArtists: string[];
  } | null>(null);
  const radioFetchingRef = useRef(false);
  const radioEmptyRunsRef = useRef(0);

  const RADIO_LOW_WATER = 5;
  // Keyed on queue length/index (like the prefetch effect) so this does NOT
  // fire on position ticks; enqueueEnd changes the length, which re-runs the
  // low-water check after each refill.
  const radioQueueLen = state.queue?.tracks.length ?? 0;
  const radioQueueIndex = state.queue?.index ?? -1;
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on radio + queue length/index
  useEffect(() => {
    if (!radio) return;
    const q = stateRef.current.queue;
    if (!q) return;
    if (q.tracks.length - q.index - 1 >= RADIO_LOW_WATER) return;
    if (radioFetchingRef.current) return;
    radioFetchingRef.current = true;

    // Radio follows the listening: seed with the current track too.
    const current = q.tracks[q.index];
    const seedTracks = current
      ? [...radio.seedTracks, { title: current.title, artist: current.artistName }]
      : radio.seedTracks;
    // Exclude everything queued, capped to the most recent window so the
    // payload stays bounded on huge queues.
    const exclude = q.tracks
      .slice(Math.max(0, q.index - 50))
      .map((t) => ({ title: t.title, artist: t.artistName }));

    void (async () => {
      try {
        const result = await window.musex.radioNext({
          seedTracks,
          seedArtists: radio.seedArtists,
          exclude,
          count: 10,
        });
        if (result.length > 0) {
          radioEmptyRunsRef.current = 0;
          void session.enqueueEnd(result);
        } else {
          radioEmptyRunsRef.current += 1;
          if (radioEmptyRunsRef.current >= 2) {
            console.warn("[radio] no recommendations — stopping");
            setRadio(null);
          }
        }
      } catch (err) {
        console.error("[radio] radioNext failed:", err);
      } finally {
        radioFetchingRef.current = false;
      }
    })();
  }, [radio, radioQueueLen, radioQueueIndex]);

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

  // ── Now-playing notifications → main's PlaybackMonitor (plugin events) ────
  // "start" means THIS track began AUDIBLY playing for the first time: a track
  // restored paused (or switched to while paused) sends nothing until the user
  // presses play. The ref tracks what we last told main so each transition is
  // sent exactly once.
  const nowPlayingRef = useRef<{ trackId: string | null; started: boolean; playing: boolean }>({
    trackId: null,
    started: false, // a "start" was sent for trackId
    playing: false,
  });
  useEffect(() => {
    const q = state.queue;
    const track = q ? (q.tracks[q.index] ?? null) : null;
    const trackId = track?.id ?? null;
    const playing = state.status === "playing";
    const prev = nowPlayingRef.current;

    // Queue gone or playback ran out → close the play-through (once).
    if (!track || state.status === "ended") {
      if (prev.started) window.musex.playbackNowPlaying({ kind: "stop" });
      nowPlayingRef.current = { trackId, started: false, playing: false };
      return;
    }

    const sendStart = () =>
      window.musex.playbackNowPlaying({
        kind: "start",
        track: toTrackInfo(track),
        atEpochSec: Math.floor(Date.now() / 1000),
      });

    if (trackId !== prev.trackId) {
      // New current track. Audible already → start now; paused (restore, or
      // skipping while paused) → wait; the same-id branch below sends the
      // deferred start when it first plays. Main closes the previous
      // play-through itself on the next "start", so no "stop" is needed here.
      if (playing) sendStart();
      nowPlayingRef.current = { trackId, started: playing, playing };
      return;
    }

    if (playing && !prev.started) {
      // Same track, first time it's audible — the deferred start.
      sendStart();
      nowPlayingRef.current = { trackId, started: true, playing };
      return;
    }

    if (prev.started && playing !== prev.playing) {
      window.musex.playbackNowPlaying({ kind: playing ? "resume" : "pause" });
    }
    nowPlayingRef.current = { trackId, started: prev.started, playing };
  }, [state.queue, state.status]);

  const api: PlayerApi = {
    state,
    playTracks: (tracks, startIndex) => {
      setRadio(null); // a deliberate new collection ends radio
      // Carry the current repeat into the new collection (but not repeat-one).
      const repeat = carryRepeat(session.getState().queue?.repeat ?? "none");
      void session.loadQueue({ ...buildQueue(tracks, startIndex), repeat });
    },
    playTracksShuffled: (tracks) => {
      setRadio(null); // a deliberate new collection ends radio
      void session.loadQueueShuffled(
        tracks,
        carryRepeat(session.getState().queue?.repeat ?? "none"),
      );
    },
    playTrackNext: (track) => void session.playTrackNext(track),
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
    radioActive: radio !== null,
    startRadioFromTrack: (track) => {
      const q = session.getState().queue;
      const current = q ? q.tracks[q.index] : undefined;
      if (current?.id !== track.id) void session.playTrackNext(track);
      radioEmptyRunsRef.current = 0;
      setRadio({
        seedTracks: [{ title: track.title, artist: track.artistName }],
        seedArtists: [],
      });
    },
    startRadioFromArtist: (artistName) => {
      radioEmptyRunsRef.current = 0;
      setRadio({ seedTracks: [], seedArtists: [artistName] });
    },
    stopRadio: () => setRadio(null),
  };

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function usePlayer(): PlayerApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("usePlayer must be used within PlayerProvider");
  return v;
}
