import type { LastfmFetch } from "@musex/core";
import { LastfmClient } from "@musex/core";
import type { LastfmConfig } from "../adapters/lastfm-store";
import { md5Hasher } from "./md5";

const AUTH_URL = "https://www.last.fm/api/auth/";

interface TrackLike {
  artistName: string;
  title: string;
  albumTitle?: string;
  durationMs?: number;
}

export interface LastfmServiceDeps {
  fetchFn: typeof fetch;
  /** Open the last.fm authorize URL and resolve when the user returns. */
  openAuth: (url: string) => Promise<void>;
  getConfig: () => Promise<LastfmConfig>;
  setConfig: (cfg: LastfmConfig) => Promise<void>;
  getSecret: () => Promise<string | null>;
  setSecret: (secret: string) => Promise<void>;
  getSessionKey: () => Promise<string | null>;
  setSessionKey: (sk: string) => Promise<void>;
  clearSession: () => Promise<void>;
}

export interface ArtistInfo {
  name: string;
  bio: string;
}

function stripHtml(s: string | undefined): string {
  return (s ?? "")
    .replace(/<a [^>]*>.*?<\/a>/gs, "")
    .replace(/<[^>]+>/g, "")
    .trim();
}

function trackParams(t: TrackLike): Record<string, string> {
  return {
    artist: t.artistName,
    track: t.title,
    ...(t.albumTitle ? { album: t.albumTitle } : {}),
    ...(t.durationMs && t.durationMs > 0
      ? { duration: String(Math.round(t.durationMs / 1000)) }
      : {}),
  };
}

export class LastfmService {
  constructor(private readonly deps: LastfmServiceDeps) {}

  private async client(): Promise<LastfmClient | null> {
    const cfg = await this.deps.getConfig();
    const secret = await this.deps.getSecret();
    if (!cfg.apiKey || !secret) return null;
    return new LastfmClient({
      apiKey: cfg.apiKey,
      secret,
      // RN's fetch type has a narrower URLSearchParams than core's LastfmFetch; cast to align.
      fetchFn: this.deps.fetchFn as unknown as LastfmFetch,
      hasher: md5Hasher,
    });
  }

  private async connectedClient(): Promise<{ c: LastfmClient; sk: string } | null> {
    const c = await this.client();
    const sk = await this.deps.getSessionKey();
    return c && sk ? { c, sk } : null;
  }

  /** Token web-auth: getToken → open authorize URL → getSession. */
  async connect(): Promise<{ ok: boolean; message: string }> {
    const c = await this.client();
    if (!c) return { ok: false, message: "Enter your API key and secret first" };
    const cfg = await this.deps.getConfig();
    try {
      const { token } = await c.call<{ token: string }>("auth.getToken", {});
      await this.deps.openAuth(
        `${AUTH_URL}?api_key=${encodeURIComponent(cfg.apiKey)}&token=${token}`,
      );
      const { session } = await c.call<{ session: { name: string; key: string } }>(
        "auth.getSession",
        { token },
      );
      await this.deps.setSessionKey(session.key);
      await this.deps.setConfig({
        ...cfg,
        username: session.name,
        connection: `Connected as ${session.name}`,
      });
      return { ok: true, message: `Connected as ${session.name}` };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, message: msg };
    }
  }

  async disconnect(): Promise<void> {
    await this.deps.clearSession();
    const cfg = await this.deps.getConfig();
    await this.deps.setConfig({ ...cfg, username: null, connection: "Not connected" });
  }

  async updateNowPlaying(track: TrackLike): Promise<void> {
    const cfg = await this.deps.getConfig();
    if (!cfg.scrobbling) return;
    const conn = await this.connectedClient();
    if (!conn) return;
    await conn.c
      .call("track.updateNowPlaying", trackParams(track), { sk: conn.sk })
      .catch(() => {});
  }

  async scrobble(track: TrackLike, startedAtMs: number): Promise<void> {
    const cfg = await this.deps.getConfig();
    if (!cfg.scrobbling) return;
    const conn = await this.connectedClient();
    if (!conn) return;
    await conn.c
      .call(
        "track.scrobble",
        { ...trackParams(track), timestamp: String(Math.floor(startedAtMs / 1000)) },
        { sk: conn.sk },
      )
      .catch(() => {});
  }

  async love(track: TrackLike): Promise<void> {
    const conn = await this.connectedClient();
    if (!conn) return;
    await conn.c
      .call("track.love", { artist: track.artistName, track: track.title }, { sk: conn.sk })
      .catch(() => {});
  }

  async unlove(track: TrackLike): Promise<void> {
    const conn = await this.connectedClient();
    if (!conn) return;
    await conn.c
      .call("track.unlove", { artist: track.artistName, track: track.title }, { sk: conn.sk })
      .catch(() => {});
  }

  async similarArtists(artist: string, limit = 12): Promise<string[]> {
    const c = await this.client();
    if (!c) return [];
    try {
      const r = await c.call<{ similarartists?: { artist?: { name: string }[] } }>(
        "artist.getSimilar",
        { artist, limit: String(limit), autocorrect: "1" },
        { signed: false },
      );
      return (r.similarartists?.artist ?? []).map((a) => a.name);
    } catch {
      return [];
    }
  }

  async artistInfo(artist: string): Promise<ArtistInfo | null> {
    const c = await this.client();
    if (!c) return null;
    try {
      const r = await c.call<{
        artist?: { name: string; bio?: { summary?: string } };
      }>("artist.getInfo", { artist, autocorrect: "1" }, { signed: false });
      if (!r.artist) return null;
      return { name: r.artist.name, bio: stripHtml(r.artist.bio?.summary) };
    } catch {
      return null;
    }
  }

  /** Similar tracks (radio seed). Returns {artist,title} candidates. */
  async recommend(
    seed: { artist: string; title?: string },
    limit = 20,
  ): Promise<{ artist: string; title: string }[]> {
    const c = await this.client();
    if (!c) return [];
    try {
      if (seed.title) {
        const r = await c.call<{
          similartracks?: { track?: { name: string; artist: { name: string } }[] };
        }>(
          "track.getSimilar",
          { artist: seed.artist, track: seed.title, limit: String(limit), autocorrect: "1" },
          { signed: false },
        );
        return (r.similartracks?.track ?? []).map((t) => ({
          artist: t.artist.name,
          title: t.name,
        }));
      }
      // artist seed → similar artists' names; the caller resolves their tracks.
      const names = await this.similarArtists(seed.artist, limit);
      return names.map((artist) => ({ artist, title: "" }));
    } catch {
      return [];
    }
  }
}
