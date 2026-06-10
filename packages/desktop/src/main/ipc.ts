import type { Artist, LibrarySort, Queue, Track } from "@musex/core";
import { createPlaylist, discoverMusicLibraries } from "@musex/core";
import type { SectionContext } from "@musex/plugin-api";
import { ipcMain, shell } from "electron";
import { isHttpUrl } from "../logic/external-url.js";
import { parseProxyPath } from "../logic/proxy-url.js";
import type {
  LoadPlaybackResult,
  NowPlayingMsg,
  PlaybackCursorDto,
  SectionTarget,
  TrackInfo,
} from "../shared/ipc-contract.js";
import { IPC } from "../shared/ipc-contract.js";
import { persistence } from "./adapters/persistence.js";
import { matchSectionsAgainstLibrary } from "./plugins/section-matching.js";
import type { Runtime } from "./runtime.js";

/** SectionContext caps: enough signal for providers, bounded payload. */
const RECENT_ARTISTS_MAX = 10;
const RECENT_TRACKS_MAX = 20;

/** Light shape check for the fire-and-forget nowPlaying channel — malformed
 *  messages are dropped with a warning rather than thrown (nobody awaits). */
function isNowPlayingMsg(msg: unknown): msg is NowPlayingMsg {
  if (typeof msg !== "object" || msg === null) return false;
  const m = msg as Record<string, unknown>;
  if (m.kind === "pause" || m.kind === "resume" || m.kind === "stop") return true;
  if (m.kind !== "start") return false;
  if (typeof m.atEpochSec !== "number" || !Number.isFinite(m.atEpochSec)) return false;
  const t = m.track as Record<string, unknown> | null | undefined;
  return (
    typeof t === "object" &&
    t !== null &&
    typeof t.title === "string" &&
    typeof t.artistName === "string" &&
    typeof t.durationMs === "number"
  );
}

/** Light shape check for renderer-supplied TrackInfo (action/detail channels). */
function isTrackInfo(t: unknown): t is TrackInfo {
  if (typeof t !== "object" || t === null) return false;
  const m = t as Record<string, unknown>;
  return (
    typeof m.title === "string" &&
    typeof m.artistName === "string" &&
    typeof m.durationMs === "number" &&
    Number.isFinite(m.durationMs)
  );
}

export function registerIpc(rt: Runtime): void {
  ipcMain.handle(IPC.signInStart, () => rt.signInStart());
  ipcMain.handle(IPC.signInPoll, () => rt.signInPoll());

  ipcMain.handle(IPC.restoreSession, async () => {
    if (!rt.token) return { library: null };
    const lib = persistence.getLibrary();
    if (lib) {
      rt.libraries = [lib];
      return { library: lib }; // instant — no network
    }
    // Signed in but no library chosen yet: discover once, then persist the chosen
    // library so the next launch returns instantly (no network on the splash).
    try {
      const result = await discoverMusicLibraries(rt.gateway, rt.token);
      rt.libraries = result.libraries;
      const first = result.libraries[0] ?? null;
      if (first) persistence.setLibrary(first);
      return { library: first };
    } catch {
      return { library: null };
    }
  });

  ipcMain.handle(IPC.discoverLibraries, async () => {
    const result = await discoverMusicLibraries(rt.gateway, rt.requireToken());
    rt.libraries = result.libraries;
    return result;
  });

  ipcMain.handle(IPC.selectLibrary, (_e, libraryId: string) => {
    const lib = rt.findLibrary(libraryId);
    persistence.setLibrary(lib);
  });

  // Browse handlers also register the stream-proxy endpoint for the server, because
  // artwork loads with browse results, before any playback.
  // ensureProxyEndpoint reuses the gateway's cached connection, so it's ~free.
  // Art URLs are baked here (full http://127.0.0.1:PORT/… URLs) so the renderer
  // can use them directly without knowing anything about the proxy or token.
  ipcMain.handle(IPC.listArtists, async (_e, libraryId: string, validator?: string) => {
    const lib = rt.findLibrary(libraryId);
    await rt.ensureProxyEndpoint(lib.serverId);
    const artists = await rt.gateway.listArtists(lib, rt.requireToken(), validator);
    return artists.map((a) => ({ ...a, thumb: rt.proxy.artUrl(a.serverId, a.thumb) }));
  });
  ipcMain.handle(
    IPC.listAlbums,
    async (_e, libraryId: string, artistId: string, validator?: string) => {
      const lib = rt.findLibrary(libraryId);
      await rt.ensureProxyEndpoint(lib.serverId);
      const albums = await rt.gateway.listAlbums(lib, artistId, rt.requireToken(), validator);
      return albums.map((a) => ({ ...a, thumb: rt.proxy.artUrl(a.serverId, a.thumb) }));
    },
  );
  ipcMain.handle(
    IPC.listTracks,
    async (_e, libraryId: string, albumId: string, validator?: string) => {
      const lib = rt.findLibrary(libraryId);
      await rt.ensureProxyEndpoint(lib.serverId);
      const tracks = await rt.gateway.listTracks(lib, albumId, rt.requireToken(), validator);
      return tracks.map((t) => ({ ...t, thumb: rt.proxy.artUrl(t.serverId, t.thumb) }));
    },
  );
  ipcMain.handle(IPC.search, async (_e, libraryId: string, query: string) => {
    const lib = rt.findLibrary(libraryId);
    await rt.ensureProxyEndpoint(lib.serverId);
    const results = await rt.gateway.search(lib, query, rt.requireToken());
    return {
      artists: results.artists.map((a) => ({ ...a, thumb: rt.proxy.artUrl(a.serverId, a.thumb) })),
      albums: results.albums.map((a) => ({ ...a, thumb: rt.proxy.artUrl(a.serverId, a.thumb) })),
      tracks: results.tracks.map((t) => ({ ...t, thumb: rt.proxy.artUrl(t.serverId, t.thumb) })),
    };
  });

  ipcMain.handle(IPC.resolveStream, async (_e, track: Track) => {
    await rt.ensureProxyEndpoint(track.serverId);
    return rt.proxy.resolve(track);
  });

  // Persist the queue with thumbs normalized to raw Plex paths (no per-launch
  // proxy secret on disk).
  ipcMain.handle(IPC.savePlaybackQueue, (_e, tracks: Track[]) => {
    const normalized = tracks.map((t) => {
      if (!t.thumb) return t;
      const parsed = parseProxyPath(t.thumb);
      return parsed ? { ...t, thumb: parsed.plexPath } : t;
    });
    persistence.setPlaybackQueue(normalized);
  });

  ipcMain.handle(IPC.savePlaybackCursor, (_e, cursor: PlaybackCursorDto) => {
    persistence.setPlaybackCursor(cursor);
  });

  // Re-bake thumbs with the CURRENT secret/port and ensure the proxy endpoint(s)
  // for the restored server(s), so restored art + the eventual play both work.
  ipcMain.handle(IPC.loadPlayback, async (): Promise<LoadPlaybackResult> => {
    const tracks = persistence.getPlaybackQueue();
    const cursor = persistence.getPlaybackCursor();
    if (!tracks || tracks.length === 0 || !cursor) return null;
    // Discard queues persisted before Track.artistId flowed correctly
    // (2026-06-09): every track having no id means pre-fix data (a real queue
    // virtually always has ids; only odd compilations lack them), and stale
    // tracks render dead artist links in the player bar. One-time reset — the
    // next play re-persists with full data.
    if (tracks.every((t) => !(t as Partial<Track>).artistId)) return null;

    const servers = new Set(tracks.map((t) => t.serverId));
    for (const serverId of servers) {
      try {
        await rt.ensureProxyEndpoint(serverId);
      } catch {
        // best-effort: art/play for an unreachable server degrade, not crash
      }
    }
    const rebaked = tracks.map((t) =>
      t.thumb ? { ...t, thumb: rt.proxy.artUrl(t.serverId, t.thumb) } : t,
    );
    const index = Math.min(Math.max(cursor.index, 0), rebaked.length - 1);
    const queue: Queue = {
      tracks: rebaked,
      index,
      shuffle: cursor.shuffle,
      repeat: cursor.repeat,
    };
    return { queue, positionSec: cursor.positionSec };
  });

  ipcMain.handle(IPC.getVolume, () => persistence.getVolume());
  ipcMain.handle(IPC.setVolume, (_e, v: number) => {
    if (typeof v !== "number" || v < 0 || v > 1) throw new Error("invalid volume");
    persistence.setVolume(v);
  });
  ipcMain.handle(IPC.getPreferences, () => ({
    cacheEnabled: persistence.getCacheEnabled(),
    cacheMaxBytes: persistence.getCacheMaxBytes(),
  }));
  ipcMain.handle(IPC.setCacheEnabled, (_e, enabled: boolean) => {
    if (typeof enabled !== "boolean") throw new Error("invalid cacheEnabled");
    persistence.setCacheEnabled(enabled);
  });
  ipcMain.handle(IPC.setCacheMaxBytes, (_e, bytes: number) => {
    const MIN = 100 * 1024 ** 2; // 100 MiB floor
    if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < MIN) {
      throw new Error("invalid cacheMaxBytes");
    }
    persistence.setCacheMaxBytes(bytes);
  });
  ipcMain.handle(IPC.getCacheStats, async () => {
    const [audio, art] = await Promise.all([rt.cache.stats(), rt.artCache.stats()]);
    return { bytes: audio.bytes + art.bytes, files: audio.files + art.files };
  });
  ipcMain.handle(IPC.clearCache, async () => {
    const [audioFreed, artFreed] = await Promise.all([rt.cache.clear(), rt.artCache.clear()]);
    return { freedBytes: audioFreed + artFreed };
  });

  ipcMain.handle(IPC.listPlaylists, async (_e, libraryId: string) => {
    const lib = rt.findLibrary(libraryId);
    await rt.ensureProxyEndpoint(lib.serverId);
    const playlists = await rt.gateway.listPlaylists(lib, rt.requireToken());
    return playlists.map((p) => ({ ...p, thumb: rt.proxy.artUrl(p.serverId, p.thumb) }));
  });
  ipcMain.handle(
    IPC.listPlaylistTracks,
    async (_e, playlistId: string, serverId: string, validator?: string) => {
      await rt.ensureProxyEndpoint(serverId);
      const items = await rt.gateway.listPlaylistTracks(
        playlistId,
        serverId,
        rt.requireToken(),
        validator,
      );
      return items.map((it) => ({
        ...it,
        track: { ...it.track, thumb: rt.proxy.artUrl(it.track.serverId, it.track.thumb) },
      }));
    },
  );
  ipcMain.handle(
    IPC.listPlaylistTracksPage,
    async (_e, playlistId: string, serverId: string, start: number, size: number) => {
      await rt.ensureProxyEndpoint(serverId);
      const result = await rt.gateway.listPlaylistTracksPage(
        playlistId,
        serverId,
        start,
        size,
        rt.requireToken(),
      );
      return {
        ...result,
        items: result.items.map((it) => ({
          ...it,
          track: { ...it.track, thumb: rt.proxy.artUrl(it.track.serverId, it.track.thumb) },
        })),
      };
    },
  );
  ipcMain.handle(
    IPC.listAllAlbums,
    async (_e, libraryId: string, sort: LibrarySort, validator?: string) => {
      const lib = rt.findLibrary(libraryId);
      await rt.ensureProxyEndpoint(lib.serverId);
      const albums = await rt.gateway.listAllAlbums(lib, sort, rt.requireToken(), validator);
      return albums.map((a) => ({ ...a, thumb: rt.proxy.artUrl(a.serverId, a.thumb) }));
    },
  );
  ipcMain.handle(
    IPC.listAllTracks,
    async (_e, libraryId: string, sort: LibrarySort, validator?: string) => {
      const lib = rt.findLibrary(libraryId);
      await rt.ensureProxyEndpoint(lib.serverId);
      const tracks = await rt.gateway.listAllTracks(lib, sort, rt.requireToken(), validator);
      return tracks.map((t) => ({ ...t, thumb: rt.proxy.artUrl(t.serverId, t.thumb) }));
    },
  );
  ipcMain.handle(
    IPC.listAllTracksPage,
    async (_e, libraryId: string, sort: LibrarySort, start: number, size: number) => {
      const lib = rt.findLibrary(libraryId);
      await rt.ensureProxyEndpoint(lib.serverId);
      const result = await rt.gateway.listAllTracksPage(lib, sort, start, size, rt.requireToken());
      return {
        ...result,
        items: result.items.map((t) => ({ ...t, thumb: rt.proxy.artUrl(t.serverId, t.thumb) })),
      };
    },
  );
  ipcMain.handle(
    IPC.createPlaylist,
    async (_e, libraryId: string, title: string, trackIds: string[]) => {
      const lib = rt.findLibrary(libraryId);
      const p = await createPlaylist(rt.gateway, lib, title, trackIds, rt.requireToken());
      return { ...p, thumb: rt.proxy.artUrl(p.serverId, p.thumb) };
    },
  );
  ipcMain.handle(
    IPC.addToPlaylist,
    (_e, playlistId: string, serverId: string, trackIds: string[]) =>
      rt.gateway.addToPlaylist(playlistId, serverId, trackIds, rt.requireToken()),
  );
  ipcMain.handle(
    IPC.removeFromPlaylist,
    (_e, playlistId: string, serverId: string, itemIds: string[]) =>
      rt.gateway.removeFromPlaylist(playlistId, serverId, itemIds, rt.requireToken()),
  );
  ipcMain.handle(IPC.renamePlaylist, (_e, playlistId: string, serverId: string, title: string) =>
    rt.gateway.renamePlaylist(playlistId, serverId, title, rt.requireToken()),
  );
  ipcMain.handle(IPC.deletePlaylist, (_e, playlistId: string, serverId: string) =>
    rt.gateway.deletePlaylist(playlistId, serverId, rt.requireToken()),
  );

  // mpv playback engine — load lazily spawns mpv; the rest are no-ops if it
  // isn't running (nothing is playing).
  ipcMain.handle(IPC.playbackLoad, (_e, args: { url: string; startSec?: number }) => {
    if (typeof args?.url !== "string" || !args.url) throw new Error("invalid url");
    return rt.mpv.load(args.url, { startSec: args.startSec });
  });
  ipcMain.handle(IPC.playbackPreload, (_e, url: string) => {
    if (typeof url !== "string" || !url) throw new Error("invalid url");
    return rt.mpv.preload(url);
  });
  ipcMain.handle(IPC.playbackPlay, () => rt.mpv.play());
  ipcMain.handle(IPC.playbackPause, () => rt.mpv.pause());
  ipcMain.handle(IPC.playbackSeek, (_e, sec: number) => {
    if (typeof sec !== "number" || !Number.isFinite(sec) || sec < 0)
      throw new Error("invalid seek");
    return rt.mpv.seek(sec);
  });
  ipcMain.handle(IPC.playbackSetVolume, (_e, v: number) => {
    if (typeof v !== "number" || v < 0 || v > 1) throw new Error("invalid volume");
    return rt.mpv.setVolume(v);
  });

  // Playback transitions from the renderer session → PlaybackMonitor → plugin
  // events. Fire-and-forget (ipcRenderer.send), so ipcMain.on, not handle.
  ipcMain.on(IPC.playbackNowPlaying, (_e, msg: unknown) => {
    if (!isNowPlayingMsg(msg)) {
      console.warn("[playback] ignoring malformed nowPlaying message:", msg);
      return;
    }
    rt.playbackMonitor.handleNowPlaying(msg);
  });

  // Plugin host — Settings → Plugins UI.
  ipcMain.handle(IPC.pluginsList, () => rt.plugins.list());
  ipcMain.handle(IPC.pluginsSetEnabled, (_e, id: string, enabled: boolean) => {
    if (typeof id !== "string" || !id) throw new Error("invalid plugin id");
    if (typeof enabled !== "boolean") throw new Error("invalid enabled flag");
    return rt.plugins.setEnabled(id, enabled);
  });
  ipcMain.handle(IPC.pluginsReload, () => rt.plugins.reloadAll());
  ipcMain.handle(IPC.pluginsGetSettings, (_e, id: string) => {
    if (typeof id !== "string" || !id) throw new Error("invalid plugin id");
    return rt.plugins.getSettings(id);
  });
  ipcMain.handle(IPC.pluginsSetSetting, (_e, id: string, key: string, value: unknown) => {
    if (typeof id !== "string" || !id) throw new Error("invalid plugin id");
    if (typeof key !== "string" || !key) throw new Error("invalid setting key");
    return rt.plugins.setSetting(id, key, value);
  });
  ipcMain.handle(IPC.pluginsSettingsAction, (_e, id: string, key: string) => {
    if (typeof id !== "string" || !id) throw new Error("invalid plugin id");
    if (typeof key !== "string" || !key) throw new Error("invalid action key");
    return rt.plugins.runSettingsAction(id, key);
  });

  // Plugin contribution surfaces — sections (Discover/Home), track actions
  // (context menu), track detail (right panel), and the renderer-facing
  // openExternal (external Discover items link out to the system browser).
  ipcMain.handle(IPC.sectionsGet, async (_e, target: SectionTarget) => {
    if (target !== "discover" && target !== "home") throw new Error("invalid sections target");
    const history = rt.playbackMonitor.history();
    const ctx: SectionContext = {
      recentArtists: [...new Set(history.map((t) => t.artistName))].slice(0, RECENT_ARTISTS_MAX),
      recentTracks: history
        .slice(0, RECENT_TRACKS_MAX)
        .map((t) => ({ title: t.title, artist: t.artistName })),
    };
    const results = await rt.plugins.getSections(target, ctx);
    // Match items against the (cached) library artist list — one fetch per call.
    let artists: Artist[] = [];
    const lib = rt.libraries[0];
    if (lib && rt.token) {
      try {
        artists = await rt.gateway.listArtists(lib, rt.token);
      } catch (err) {
        // Matching is best-effort: items render as external instead of failing.
        console.error("[plugins] sections library matching failed:", err);
      }
    }
    return matchSectionsAgainstLibrary(results, artists);
  });
  ipcMain.handle(IPC.trackActionsList, () => rt.plugins.listTrackActions());
  ipcMain.handle(IPC.trackActionsInvoke, (_e, actionId: string, track: unknown) => {
    if (typeof actionId !== "string" || !actionId) throw new Error("invalid action id");
    if (!isTrackInfo(track)) throw new Error("invalid track info");
    return rt.plugins.invokeTrackAction(actionId, track);
  });
  ipcMain.handle(IPC.trackDetailGet, (_e, track: unknown) => {
    if (!isTrackInfo(track)) throw new Error("invalid track info");
    return rt.plugins.getTrackDetails(track);
  });
  ipcMain.handle(IPC.openExternal, (_e, url: unknown) => {
    if (typeof url !== "string" || !isHttpUrl(url)) throw new Error("invalid external url");
    void shell.openExternal(url);
  });

  ipcMain.handle(IPC.prefetch, async (_e, tracks: Track[]) => {
    const upcoming: { serverId: string; plexPath: string }[] = [];
    for (const t of tracks) {
      await rt.ensureProxyEndpoint(t.serverId);
      upcoming.push({ serverId: t.serverId, plexPath: t.media.partKey });
    }
    rt.proxy.prefetch(upcoming);
  });
}
