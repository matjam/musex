import { randomUUID } from "node:crypto";
import Store from "electron-store";

export interface PersistedState {
  clientId: string;
  selectedLibraryId: string | null;
  selectedServerId: string | null;
  volume: number;
}

const store = new Store<PersistedState>({
  defaults: {
    clientId: "",
    selectedLibraryId: null,
    selectedServerId: null,
    volume: 1,
  },
});

/** A stable per-install Plex client identifier (generated once, then reused). */
export function getClientId(): string {
  let id = store.get("clientId");
  if (!id) {
    id = randomUUID();
    store.set("clientId", id);
  }
  return id;
}

export const persistence = {
  getSelection(): { serverId: string | null; libraryId: string | null } {
    return { serverId: store.get("selectedServerId"), libraryId: store.get("selectedLibraryId") };
  },
  setSelection(serverId: string, libraryId: string): void {
    store.set("selectedServerId", serverId);
    store.set("selectedLibraryId", libraryId);
  },
  getVolume(): number {
    return store.get("volume");
  },
  setVolume(v: number): void {
    store.set("volume", v);
  },
};
