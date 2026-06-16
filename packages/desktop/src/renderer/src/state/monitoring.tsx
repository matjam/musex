import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
} from "react";
import { isMonitored, isWatched, monitoringReducer } from "./monitoring-reducer";

interface MonitoringApi {
  isMonitored(name: string): boolean;
  isWatched(name: string): boolean;
  setMonitored(name: string, value: boolean): Promise<void>;
  setWatched(name: string, value: boolean): Promise<void>;
  refresh(): void;
}

const Ctx = createContext<MonitoringApi | null>(null);

/** Reactive monitor/watch state for artists, seeded from the acquisition
 *  provider. Optimistic toggles; reverts on IPC failure (callers may also
 *  surface a toast). One store so every discovery view stays consistent. */
export function MonitoringProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(monitoringReducer, {
    monitored: new Set<string>(),
    watched: new Set<string>(),
  });

  const refresh = useCallback(() => {
    void Promise.all([
      window.musex.acquisitionMonitoredArtists(),
      window.musex.newReleaseWatchList(),
    ])
      .then(([monitored, watched]) =>
        // newReleaseWatchList() returns string[] (watched artist names); seed directly.
        dispatch({ type: "seed", monitored: monitored ?? [], watched: watched ?? [] }),
      )
      .catch((err: unknown) => console.error("[monitoring] seed failed:", err));
  }, []);

  useEffect(refresh, [refresh]);

  const api = useMemo<MonitoringApi>(
    () => ({
      isMonitored: (n) => isMonitored(state, n),
      isWatched: (n) => isWatched(state, n),
      async setMonitored(name, value) {
        dispatch({ type: "setMonitored", name, value });
        try {
          await window.musex.acquisitionAcquireArtistByName(name);
        } catch (err) {
          dispatch({ type: "setMonitored", name, value: !value });
          throw err;
        }
      },
      async setWatched(name, value) {
        dispatch({ type: "setWatched", name, value });
        try {
          await window.musex.newReleaseWatchSet(name, value);
        } catch (err) {
          dispatch({ type: "setWatched", name, value: !value });
          throw err;
        }
      },
      refresh,
    }),
    [state, refresh],
  );

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useMonitoring(): MonitoringApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("useMonitoring must be used within MonitoringProvider");
  return v;
}
