import type { Playlist } from "@musex/core";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { useApp } from "./app";

interface PlaylistsApi {
  playlists: Playlist[];
  refresh(): void;
  create(title: string, trackIds: string[]): Promise<Playlist>;
  addTo(playlistId: string, serverId: string, trackIds: string[]): Promise<void>;
  remove(playlistId: string, serverId: string, playlistItemIds: string[]): Promise<void>;
  rename(playlistId: string, serverId: string, title: string): Promise<void>;
  destroy(playlistId: string, serverId: string): Promise<void>;
}

const Ctx = createContext<PlaylistsApi | null>(null);

export function PlaylistsProvider({ children }: { children: ReactNode }) {
  const { library } = useApp();
  const [playlists, setPlaylists] = useState<Playlist[]>([]);

  const refresh = useCallback(() => {
    if (!library) {
      setPlaylists([]);
      return;
    }
    window.musex
      .listPlaylists(library.id)
      .then(setPlaylists)
      .catch(() => setPlaylists([]));
  }, [library]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const api: PlaylistsApi = {
    playlists,
    refresh,
    create: async (title, trackIds) => {
      if (!library) throw new Error("No library");
      const p = await window.musex.createPlaylist(library.id, title, trackIds);
      refresh();
      return p;
    },
    addTo: async (playlistId, serverId, trackIds) => {
      await window.musex.addToPlaylist(playlistId, serverId, trackIds);
      refresh();
    },
    remove: async (playlistId, serverId, ids) => {
      await window.musex.removeFromPlaylist(playlistId, serverId, ids);
      refresh();
    },
    rename: async (playlistId, serverId, title) => {
      await window.musex.renamePlaylist(playlistId, serverId, title);
      refresh();
    },
    destroy: async (playlistId, serverId) => {
      await window.musex.deletePlaylist(playlistId, serverId);
      refresh();
    },
  };

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function usePlaylists(): PlaylistsApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("usePlaylists must be used within PlaylistsProvider");
  return v;
}
