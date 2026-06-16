export interface MonitoringState {
  monitored: Set<string>;
  watched: Set<string>;
}

export type MonitoringAction =
  | { type: "seed"; monitored: string[]; watched: string[] }
  | { type: "setMonitored"; name: string; value: boolean }
  | { type: "setWatched"; name: string; value: boolean };

const k = (s: string) => s.trim().toLowerCase();

const withToggle = (set: Set<string>, name: string, value: boolean): Set<string> => {
  const next = new Set(set);
  if (value) next.add(k(name));
  else next.delete(k(name));
  return next;
};

export function monitoringReducer(state: MonitoringState, a: MonitoringAction): MonitoringState {
  switch (a.type) {
    case "seed":
      return { monitored: new Set(a.monitored.map(k)), watched: new Set(a.watched.map(k)) };
    case "setMonitored":
      return { ...state, monitored: withToggle(state.monitored, a.name, a.value) };
    case "setWatched":
      return { ...state, watched: withToggle(state.watched, a.name, a.value) };
  }
}

export const isMonitored = (s: MonitoringState, name: string) => s.monitored.has(k(name));
export const isWatched = (s: MonitoringState, name: string) => s.watched.has(k(name));
