import type { Album, Artist, LibrarySort, Queue, Track } from "@musex/core";
import { createPlaylist, discoverMusicLibraries, isHttpUrl, pickDefaultLibrary } from "@musex/core";
import type { SectionContext } from "@musex/plugin-api";
import { ipcMain, shell } from "electron";
import { buildAf, replaygainMode, sanitizeAudioPrefs } from "../logic/audio-filters.js";
import { parseProxyPath } from "../logic/proxy-url.js";
import type {
  AcquirableAlbumDto,
  ArtistInfoDto,
  ExpansionEntryDto,
  ExpansionStateDto,
  ExternalArtistResultDto,
  LoadPlaybackResult,
  LogLevel,
  NowPlayingMsg,
  PlaybackCursorDto,
  RadioNextArgs,
  SectionItemDto,
  SectionTarget,
  SimilarGetArgs,
  TrackInfo,
} from "../shared/ipc-contract.js";
import { IPC } from "../shared/ipc-contract.js";
import { persistence } from "./adapters/persistence.js";
import { isSecureStorageAvailable } from "./adapters/secure-store-host.js";
import { LOG_LEVELS, logBuffer } from "./logging.js";
import { resolveRecommendations } from "./plugins/radio-resolve.js";
import {
  matchItemsAgainstLibrary,
  matchSectionsAgainstLibrary,
} from "./plugins/section-matching.js";
import { resolveSimilarTracks } from "./plugins/similar-resolve.js";
import type { Runtime } from "./runtime.js";

/** SectionContext caps: enough signal for providers, bounded payload. */
const RECENT_ARTISTS_MAX = 10;
const RECENT_TRACKS_MAX = 20;
const TOP_ARTISTS_MAX = 10;

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

/** Cap on tracks one radioNext call may return (defense against silly args). */
const RADIO_COUNT_MAX = 50;

/** Loose shape filter for renderer-supplied {title, artist} pairs — IPC input
 *  is untrusted, so malformed entries are dropped rather than thrown over. */
function titleArtistPairs(v: unknown): { title: string; artist: string }[] {
  if (!Array.isArray(v)) return [];
  return v.filter((p): p is { title: string; artist: string } => {
    if (typeof p !== "object" || p === null) return false;
    const m = p as Record<string, unknown>;
    return typeof m.title === "string" && typeof m.artist === "string";
  });
}

/** Suppress repeated toasts for the same mpv-unavailable message (e.g. rapid
 *  load+preload+play attempts). One notification per unique message per 5s. */
const mpvNotifyLastAt = new Map<string, number>();
const MPV_NOTIFY_DEBOUNCE_MS = 5_000;

/** Throws with the user-facing unavailability reason when mpv isn't running.
 *  Also pushes a toast through the plugin-notify channel so the user sees it.
 *  Used by every playback handler so the renderer surfaces a clear message
 *  rather than a generic "Cannot read properties of null" crash. */
function requireMpv(rt: Runtime) {
  if (!rt.mpv) {
    const reason = rt.mpvUnavailableReason ?? "mpv unavailable";
    const now = Date.now();
    const last = mpvNotifyLastAt.get(reason) ?? 0;
    if (now - last > MPV_NOTIFY_DEBOUNCE_MS) {
      mpvNotifyLastAt.set(reason, now);
      rt.pushNotification({ pluginId: "musex", message: reason, level: "error" });
    }
    throw new Error(reason);
  }
  return rt.mpv;
}

/** Bake a plugin-supplied artwork URL through the proxy's /ext endpoint so
 *  it's disk-cached (art cache) and loads offline. Non-https/unparseable URLs
 *  are dropped rather than handed to the renderer. */
function bakeExternalArt(rt: Runtime, item: SectionItemDto): SectionItemDto {
  if (item.imageUrl === undefined) return item;
  const proxied = rt.proxy.externalArtUrl(item.imageUrl);
  if (proxied === undefined) {
    const { imageUrl: _dropped, ...rest } = item;
    return rest;
  }
  return { ...item, imageUrl: proxied };
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
      const first = pickDefaultLibrary(result.libraries);
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
    rt.libraryWatcher.setLibrary(lib);
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
  ipcMain.handle(IPC.getAudioPrefs, () => persistence.getAudioPrefs());
  ipcMain.handle(IPC.setAudioPrefs, async (_e, raw: unknown) => {
    const prefs = sanitizeAudioPrefs(raw);
    // Apply to mpv FIRST; persist only after it accepted (an mpv rejection
    // propagates to the renderer and the old prefs stay in force).
    // No-op when mpv is unavailable — prefs are persisted so they take effect
    // if mpv becomes available on a future launch.
    if (rt.mpv) {
      await rt.mpv.applyAudioConfig({ af: buildAf(prefs), replaygain: replaygainMode(prefs) });
    }
    persistence.setAudioPrefs(prefs);
  });
  ipcMain.handle(IPC.getPreferences, () => ({
    cacheEnabled: persistence.getCacheEnabled(),
    cacheMaxBytes: persistence.getCacheMaxBytes(),
    secureStorageAvailable: isSecureStorageAvailable(),
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

  ipcMain.handle(
    IPC.rateItem,
    async (
      _e,
      args: {
        serverId: string;
        itemId: string;
        rating: number | null;
        albumId?: string;
        artistId?: string;
        libraryId?: string;
        trackInfo?: TrackInfo;
        artistName?: string;
      },
    ) => {
      if (typeof args?.serverId !== "string" || !args.serverId) throw new Error("invalid serverId");
      if (typeof args.itemId !== "string" || !args.itemId) throw new Error("invalid itemId");
      if (args.artistId !== undefined && (typeof args.artistId !== "string" || !args.artistId)) {
        throw new Error("invalid artistId");
      }
      const r = args.rating;
      if (r !== null && (!Number.isInteger(r) || r < 0 || r > 10)) {
        throw new Error("invalid rating");
      }
      await rt.gateway.rateItem(args.serverId, args.itemId, r, rt.requireToken(), {
        albumId: args.albumId,
        artistId: args.artistId,
        libraryId: args.libraryId,
      });
      // Track ratings only — the renderer sends trackInfo for tracks, never
      // for artists. Shape-check it (IPC input is untrusted) before fanning
      // out to plugins / feeding the taste profile.
      const ti = args.trackInfo;
      if (
        typeof ti === "object" &&
        ti !== null &&
        typeof ti.title === "string" &&
        typeof ti.artistName === "string"
      ) {
        rt.plugins.emitEvent("trackRated", { track: ti, rating10: r });
        rt.tasteProfile.recordTrackRating(ti, r);
        rt.saveTasteProfileSoon();
      } else if (typeof args.artistName === "string" && args.artistName) {
        // Artist ratings carry the name instead (no TrackInfo, no plugin event).
        rt.tasteProfile.recordArtistRating(args.artistName, r);
        rt.saveTasteProfileSoon();
      }
    },
  );
  ipcMain.handle(IPC.getUserRating, (_e, serverId: string, itemId: string) => {
    if (typeof serverId !== "string" || !serverId) throw new Error("invalid serverId");
    if (typeof itemId !== "string" || !itemId) throw new Error("invalid itemId");
    return rt.gateway.getUserRating(serverId, itemId, rt.requireToken());
  });

  // Taste snapshot for the renderer's smart playlists: per-track play stats
  // (with read-time decayed plays) + decayed artist affinity. Main computes
  // the decayed values so the renderer never sees raw profile internals.
  ipcMain.handle(IPC.getTasteSnapshot, () => ({
    stats: rt.tasteProfile.trackStats().map((s) => ({
      key: s.key,
      plays: s.plays,
      skips: s.skips,
      lastPlayedMs: s.lastPlayedMs,
      decayedPlays: s.decayedPlays,
      ratingStars: s.ratingStars,
    })),
    topArtists: rt.tasteProfile.topArtists(),
  }));

  // mpv playback engine — load lazily spawns mpv; the rest are no-ops if it
  // isn't running (nothing is playing). requireMpv() surfaces a user-facing
  // reason when mpv is unavailable (e.g. missing system mpv on Linux).
  ipcMain.handle(IPC.playbackLoad, (_e, args: { url: string; startSec?: number }) => {
    if (typeof args?.url !== "string" || !args.url) throw new Error("invalid url");
    return requireMpv(rt).load(args.url, { startSec: args.startSec });
  });
  ipcMain.handle(IPC.playbackPreload, (_e, url: string) => {
    if (typeof url !== "string" || !url) throw new Error("invalid url");
    return requireMpv(rt).preload(url);
  });
  ipcMain.handle(IPC.playbackPlay, () => requireMpv(rt).play());
  ipcMain.handle(IPC.playbackPause, () => requireMpv(rt).pause());
  ipcMain.handle(IPC.playbackSeek, (_e, sec: number) => {
    if (typeof sec !== "number" || !Number.isFinite(sec) || sec < 0)
      throw new Error("invalid seek");
    return requireMpv(rt).seek(sec);
  });
  ipcMain.handle(IPC.playbackSetVolume, (_e, v: number) => {
    if (typeof v !== "number" || v < 0 || v > 1) throw new Error("invalid volume");
    return requireMpv(rt).setVolume(v);
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
  ipcMain.handle(IPC.pluginsFetchManifest, (_e, repoUrl: string) => {
    if (typeof repoUrl !== "string" || !repoUrl) throw new Error("invalid repo url");
    return rt.pluginInstaller.fetchManifest(repoUrl);
  });
  ipcMain.handle(IPC.pluginsInstall, (_e, repoUrl: string, id: string) => {
    if (typeof repoUrl !== "string" || !repoUrl) throw new Error("invalid repo url");
    if (typeof id !== "string" || !id) throw new Error("invalid plugin id");
    return rt.pluginInstaller.install(repoUrl, id);
  });
  ipcMain.handle(IPC.pluginsUninstall, (_e, id: string) => {
    if (typeof id !== "string" || !id) throw new Error("invalid plugin id");
    return rt.pluginInstaller.uninstall(id);
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
      topArtists: rt.tasteProfile.topArtists(TOP_ARTISTS_MAX),
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
    // Plugin-supplied artwork is an external https URL; bake it through the
    // proxy's /ext endpoint so it's disk-cached (art cache) and loads offline.
    return matchSectionsAgainstLibrary(results, artists).map((section) => ({
      ...section,
      items: section.items.map((item) => bakeExternalArt(rt, item)),
    }));
  });

  // Similar side panel: fan out to plugin similar-providers. Artist items are
  // matched against the library exactly like sections (owned → navigate);
  // track items resolve to owned playable tracks via library search (the same
  // approach radio resolution uses). Everything unowned is flagged external.
  ipcMain.handle(IPC.similarGet, async (_e, args: SimilarGetArgs): Promise<SectionItemDto[]> => {
    if (typeof args !== "object" || args === null) throw new Error("invalid similarGet args");
    const lib = rt.libraries[0];
    const token = rt.token;
    if (args.kind === "artist") {
      if (typeof args.name !== "string" || !args.name) throw new Error("invalid artist name");
      const items = await rt.plugins.getSimilar("artist", { name: args.name });
      let artists: Artist[] = [];
      if (lib && token) {
        try {
          artists = await rt.gateway.listArtists(lib, token);
        } catch (err) {
          // Matching is best-effort: items render as external instead of failing.
          console.error("[plugins] similar library matching failed:", err);
        }
      }
      return matchItemsAgainstLibrary(items, artists).map((item) => bakeExternalArt(rt, item));
    }
    if (args.kind === "track") {
      if (typeof args.title !== "string" || !args.title) throw new Error("invalid track title");
      if (typeof args.artist !== "string" || !args.artist) throw new Error("invalid track artist");
      const items = await rt.plugins.getSimilar("track", {
        title: args.title,
        artist: args.artist,
      });
      if (!lib || !token) {
        return items.map((item) => bakeExternalArt(rt, { ...item, external: true }));
      }
      await rt.ensureProxyEndpoint(lib.serverId);
      const resolved = await resolveSimilarTracks(items, (query) =>
        rt.gateway.search(lib, query, token).then((r) => ({ tracks: r.tracks })),
      );
      return resolved.map((item) => {
        const baked = bakeExternalArt(rt, item);
        return baked.track
          ? {
              ...baked,
              track: {
                ...baked.track,
                thumb: rt.proxy.artUrl(baked.track.serverId, baked.track.thumb),
              },
            }
          : baked;
      });
    }
    throw new Error("invalid similarGet kind");
  });
  // Acquisition (e.g. Lidarr): external-artist discography lookup with an
  // owned cross-check against the library, acquire routing, download status.
  ipcMain.handle(IPC.acquisitionAvailable, () => rt.plugins.acquisitionAvailable());

  ipcMain.handle(
    IPC.acquisitionLookupArtist,
    async (_e, artistName: unknown): Promise<AcquirableAlbumDto[]> => {
      if (typeof artistName !== "string" || !artistName) throw new Error("invalid artist name");
      const items = await rt.plugins.lookupArtistAlbums(artistName);
      // Owned cross-check: find the artist in the library (case-insensitive
      // exact name via search), then mark lookup items whose title matches an
      // owned album. Best-effort — signed out / lookup failure means items
      // simply keep their provider-reported state.
      const lib = rt.libraries[0];
      const token = rt.token;
      let ownedArtist: Artist | undefined;
      let ownedAlbums: Album[] = [];
      if (lib && token && items.length > 0) {
        try {
          const results = await rt.gateway.search(lib, artistName, token);
          const lower = artistName.toLowerCase();
          ownedArtist = results.artists.find((a) => a.name.toLowerCase() === lower);
          if (ownedArtist) {
            ownedAlbums = await rt.gateway.listAlbums(lib, ownedArtist.id, token);
          }
        } catch (err) {
          console.error("[plugins] acquisition owned cross-check failed:", err);
        }
      }
      const ownedByTitle = new Map<string, Album>();
      for (const a of ownedAlbums) {
        // trim() matches mergeDiscography's key — a whitespace-padded provider
        // title must still flip to owned.
        const key = a.title.trim().toLowerCase();
        if (!ownedByTitle.has(key)) ownedByTitle.set(key, a);
      }
      return items.map((item): AcquirableAlbumDto => {
        const owned = ownedArtist ? ownedByTitle.get(item.title.trim().toLowerCase()) : undefined;
        if (owned && ownedArtist) {
          return {
            ...item,
            state: "owned",
            albumId: owned.id,
            artistId: ownedArtist.id,
            serverId: owned.serverId,
          };
        }
        // Non-owned: bake plugin-supplied artwork through the proxy's /ext
        // endpoint (disk-cached, loads offline); unbakeable URLs are dropped.
        if (item.imageUrl !== undefined) {
          const proxied = rt.proxy.externalArtUrl(item.imageUrl);
          if (proxied === undefined) {
            const { imageUrl: _dropped, ...rest } = item;
            return rest;
          }
          return { ...item, imageUrl: proxied };
        }
        return item;
      });
    },
  );

  ipcMain.handle(
    IPC.acquisitionAcquire,
    (_e, args: { providerId?: unknown; providerRef?: unknown } | null | undefined) => {
      if (typeof args?.providerId !== "string" || !args.providerId) {
        throw new Error("invalid providerId");
      }
      if (typeof args.providerRef !== "string" || !args.providerRef) {
        throw new Error("invalid providerRef");
      }
      return rt.plugins.acquireAlbum(args.providerId, args.providerRef);
    },
  );

  ipcMain.handle(IPC.acquisitionStatus, () => rt.plugins.acquisitionStatus());

  // Federated external artist search (SearchView's "Not in your library"
  // section). Artwork is baked through the proxy's /ext endpoint like every
  // other plugin-supplied image; unbakeable URLs are dropped.
  ipcMain.handle(
    IPC.acquisitionSearchArtists,
    async (_e, term: unknown): Promise<ExternalArtistResultDto[]> => {
      if (typeof term !== "string" || !term) throw new Error("invalid search term");
      const items = await rt.plugins.searchExternalArtists(term);
      return items.map((item): ExternalArtistResultDto => {
        if (item.imageUrl === undefined) return item;
        const proxied = rt.proxy.externalArtUrl(item.imageUrl);
        if (proxied === undefined) {
          const { imageUrl: _dropped, ...rest } = item;
          return rest;
        }
        return { ...item, imageUrl: proxied };
      });
    },
  );

  ipcMain.handle(
    IPC.acquisitionAcquireArtist,
    (_e, args: { providerId?: unknown; providerRef?: unknown } | null | undefined) => {
      if (typeof args?.providerId !== "string" || !args.providerId) {
        throw new Error("invalid providerId");
      }
      if (typeof args.providerRef !== "string" || !args.providerRef) {
        throw new Error("invalid providerRef");
      }
      return rt.plugins.acquireArtist(args.providerId, args.providerRef);
    },
  );

  ipcMain.handle(IPC.acquisitionAcquireArtistByName, (_e, artistName: unknown) => {
    if (typeof artistName !== "string" || !artistName) throw new Error("invalid artist name");
    return rt.plugins.acquireArtistByName(artistName);
  });

  ipcMain.handle(
    IPC.artistInfoGet,
    async (_e, artistName: unknown): Promise<ArtistInfoDto | null> => {
      if (typeof artistName !== "string" || !artistName) throw new Error("invalid artist name");
      const info = await rt.plugins.artistInfo(String(artistName));
      if (!info) return null;
      if (info.imageUrl === undefined) return info;
      // Bake plugin-supplied artwork through the proxy's /ext endpoint so it
      // is disk-cached and loads offline — same treatment as every other
      // plugin-supplied image (section items, acquisition album art, etc.).
      const proxied = rt.proxy.externalArtUrl(info.imageUrl);
      if (proxied === undefined) {
        const { imageUrl: _dropped, ...rest } = info;
        return rest;
      }
      return { ...info, imageUrl: proxied };
    },
  );

  ipcMain.handle(IPC.acquisitionMonitoredArtists, () => rt.plugins.listMonitoredArtists());

  ipcMain.handle(
    IPC.acquisitionDiscography,
    async (_e, artistName: unknown): Promise<AcquirableAlbumDto[]> => {
      if (typeof artistName !== "string" || !artistName) throw new Error("invalid artist name");
      const items = await rt.plugins.externalDiscography(artistName);
      // Same owned cross-check + image-proxy enrichment as acquisitionLookupArtist.
      const lib = rt.libraries[0];
      const token = rt.token;
      let ownedArtist: Artist | undefined;
      let ownedAlbums: Album[] = [];
      if (lib && token && items.length > 0) {
        try {
          const results = await rt.gateway.search(lib, artistName, token);
          const lower = artistName.toLowerCase();
          ownedArtist = results.artists.find((a) => a.name.toLowerCase() === lower);
          if (ownedArtist) {
            ownedAlbums = await rt.gateway.listAlbums(lib, ownedArtist.id, token);
          }
        } catch (err) {
          console.error("[plugins] acquisitionDiscography owned cross-check failed:", err);
        }
      }
      const ownedByTitle = new Map<string, Album>();
      for (const a of ownedAlbums) {
        // trim() matches mergeDiscography's key — a whitespace-padded provider
        // title must still flip to owned.
        const key = a.title.trim().toLowerCase();
        if (!ownedByTitle.has(key)) ownedByTitle.set(key, a);
      }
      return items.map((item): AcquirableAlbumDto => {
        const owned = ownedArtist ? ownedByTitle.get(item.title.trim().toLowerCase()) : undefined;
        if (owned && ownedArtist) {
          return {
            ...item,
            state: "owned",
            albumId: owned.id,
            artistId: ownedArtist.id,
            serverId: owned.serverId,
          };
        }
        // Non-owned: bake plugin-supplied artwork through the proxy's /ext
        // endpoint (disk-cached, loads offline); unbakeable URLs are dropped.
        if (item.imageUrl !== undefined) {
          const proxied = rt.proxy.externalArtUrl(item.imageUrl);
          if (proxied === undefined) {
            const { imageUrl: _dropped, ...rest } = item;
            return rest;
          }
          return { ...item, imageUrl: proxied };
        }
        return item;
      });
    },
  );

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

  // ── Taste expansion + new-release watching ────────────────────────────────
  const expansionState = (): ExpansionStateDto => {
    const status = rt.expansion.status();
    const entries = [...persistence.getExpansionLedger()]
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(
        (e): ExpansionEntryDto => ({
          artistName: e.artistName,
          albumTitle: e.albumTitle,
          state: e.state,
          deepening: e.deepening,
          retried: e.retried,
          provenance: e.provenance,
          ...(e.note !== undefined ? { note: e.note } : {}),
          createdAt: e.createdAt,
          ...(e.requestedAt !== undefined ? { requestedAt: e.requestedAt } : {}),
          ...(e.landedAt !== undefined ? { landedAt: e.landedAt } : {}),
          ...(e.abandonedAt !== undefined ? { abandonedAt: e.abandonedAt } : {}),
          ...(e.rejectedAt !== undefined ? { rejectedAt: e.rejectedAt } : {}),
        }),
      );
    return {
      prefs: persistence.getExpansionPrefs(),
      running: status.running,
      lastRunAt: status.lastRunAt,
      lastSummary: status.lastSummary,
      available: rt.plugins.expansionCapabilities(),
      entries,
    };
  };
  ipcMain.handle(IPC.expansionGetState, () => expansionState());
  ipcMain.handle(IPC.expansionSetPrefs, (_e, prefs: unknown) => {
    if (typeof prefs !== "object" || prefs === null) throw new Error("invalid expansion prefs");
    const p = prefs as Record<string, unknown>;
    if (
      typeof p.enabled !== "boolean" ||
      typeof p.albumsPerWeek !== "number" ||
      typeof p.aggressiveness !== "number"
    ) {
      throw new Error("invalid expansion prefs");
    }
    persistence.setExpansionPrefs({
      enabled: p.enabled,
      albumsPerWeek: Math.min(10, Math.max(1, Math.round(p.albumsPerWeek))),
      aggressiveness: Math.min(100, Math.max(0, Math.round(p.aggressiveness))),
    });
  });
  ipcMain.handle(IPC.expansionRunNow, async () => {
    await rt.expansion.runCycle();
    return expansionState();
  });
  ipcMain.handle(IPC.expansionReject, (_e, artistName: unknown) => {
    if (typeof artistName !== "string" || !artistName) throw new Error("invalid artist name");
    return rt.expansion.reject(artistName);
  });
  ipcMain.handle(IPC.newReleaseWatchGet, (_e, artistName: unknown) => {
    if (typeof artistName !== "string" || !artistName) throw new Error("invalid artist name");
    return rt.plugins.isWatchingNewReleases(artistName);
  });
  ipcMain.handle(IPC.newReleaseWatchSet, (_e, artistName: unknown, enabled: unknown) => {
    if (typeof artistName !== "string" || !artistName) throw new Error("invalid artist name");
    if (typeof enabled !== "boolean") throw new Error("invalid enabled flag");
    return rt.plugins.watchNewReleases(artistName, enabled);
  });
  ipcMain.handle(IPC.newReleaseWatchList, () => rt.plugins.listWatchedArtists());

  // Unified log buffer (Help → Show Logs).
  ipcMain.handle(IPC.logsGet, () => logBuffer.snapshot());
  ipcMain.handle(IPC.logsAppend, (_e, entries: unknown) => {
    if (!Array.isArray(entries)) return;
    // Bounded batch + text length: this channel is fed by a console hook, so
    // a runaway logger must not balloon the buffer or the IPC payloads.
    for (const entry of entries.slice(0, 200)) {
      if (typeof entry !== "object" || entry === null) continue;
      const { ts, level, text } = entry as Record<string, unknown>;
      if (typeof text !== "string") continue;
      logBuffer.append({
        ts: typeof ts === "number" && Number.isFinite(ts) ? ts : Date.now(),
        source: "renderer",
        level: LOG_LEVELS.includes(level as LogLevel) ? (level as LogLevel) : "log",
        text: text.slice(0, 8192),
      });
    }
  });

  // Radio refill: plugin recommenders suggest, the host resolves against the
  // library and returns real playable tracks (proxy-baked thumbs). Empty when
  // signed out / no library — the renderer treats that as "radio ran dry".
  ipcMain.handle(IPC.radioNext, async (_e, args: RadioNextArgs): Promise<Track[]> => {
    if (typeof args !== "object" || args === null) throw new Error("invalid radioNext args");
    if (typeof args.count !== "number" || !Number.isFinite(args.count) || args.count < 1) {
      throw new Error("invalid count");
    }
    const count = Math.min(Math.floor(args.count), RADIO_COUNT_MAX);
    const seedTracks = titleArtistPairs(args.seedTracks);
    const exclude = titleArtistPairs(args.exclude);
    const seedArtists = Array.isArray(args.seedArtists)
      ? args.seedArtists.filter((a): a is string => typeof a === "string" && a.length > 0)
      : [];

    const lib = rt.libraries[0];
    const token = rt.token;
    if (!lib || !token) return [];

    const recs = await rt.plugins.recommendTracks({ seedTracks, seedArtists, exclude, count });
    if (recs.length === 0) return [];

    await rt.ensureProxyEndpoint(lib.serverId);
    const tracks = await resolveRecommendations(recs, exclude, count, (query) =>
      rt.gateway.search(lib, query, token).then((r) => ({ tracks: r.tracks })),
    );
    return tracks.map((t) => ({ ...t, thumb: rt.proxy.artUrl(t.serverId, t.thumb) }));
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
