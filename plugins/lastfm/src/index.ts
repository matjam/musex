/**
 * @musex/plugin-lastfm — scrobbling, now-playing and a "Love" track action.
 *
 * Runs full-trust in the Electron main process; codes purely against the
 * @musex/plugin-api types (compile-time only) + node:crypto. Never imports
 * electron or any @musex runtime code.
 */
import type { PluginContext, PluginEvents, TrackInfo } from "@musex/plugin-api";
import { isLastfmError, LastfmClient } from "./client.js";

const AUTH_URL = "https://www.last.fm/api/auth/";
const AUTH_POLL_INTERVAL_MS = 5_000;
const AUTH_POLL_TIMEOUT_MS = 120_000;

type TokenResponse = { token: string };
type SessionResponse = { session: { name: string; key: string } };

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** artist/track/album?/duration? params shared by updateNowPlaying + scrobble. */
function trackParams(t: TrackInfo): Record<string, string> {
  return {
    artist: t.artistName,
    track: t.title,
    ...(t.albumTitle !== undefined ? { album: t.albumTitle } : {}),
    ...(t.durationMs > 0 ? { duration: String(Math.round(t.durationMs / 1000)) } : {}),
  };
}

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));

export async function activate(ctx: PluginContext): Promise<void> {
  ctx.registerSettings([
    {
      kind: "text",
      key: "apiKey",
      label: "API key",
      help: "Create one at last.fm/api/account/create",
    },
    { kind: "password", key: "apiSecret", label: "Shared secret" },
    { kind: "action", key: "connect", label: "Connect Last.fm account" },
    { kind: "status", key: "connection" },
    { kind: "toggle", key: "scrobbling", label: "Scrobble plays" },
  ]);

  if ((await ctx.storage.get<string>("connection")) === null) {
    await ctx.storage.set("connection", "Not connected");
  }

  const credentials = async (): Promise<{ apiKey: string; secret: string } | null> => {
    const apiKey = await ctx.storage.get<string>("apiKey");
    const secret = await ctx.secrets.get("apiSecret");
    if (!apiKey || !secret) return null;
    return { apiKey, secret };
  };

  const client = async (): Promise<LastfmClient | null> => {
    const creds = await credentials();
    if (!creds) return null;
    return new LastfmClient({ apiKey: creds.apiKey, secret: creds.secret, fetchFn: ctx.fetch });
  };

  /** Connected = key+secret present AND a stored session key. */
  const session = async (): Promise<{ client: LastfmClient; sk: string } | null> => {
    const c = await client();
    if (!c) return null;
    const sk = await ctx.secrets.get("sessionKey");
    if (!sk) return null;
    return { client: c, sk };
  };

  // ── Connect (desktop auth flow) ───────────────────────────────────────────
  ctx.onSettingsAction("connect", async () => {
    const creds = await credentials();
    if (!creds) return { ok: false, message: "Enter API key and shared secret first" };
    const c = new LastfmClient({ apiKey: creds.apiKey, secret: creds.secret, fetchFn: ctx.fetch });
    const { token } = await c.call<TokenResponse>("auth.getToken", {});
    ctx.ui.openExternal(
      `${AUTH_URL}?api_key=${encodeURIComponent(creds.apiKey)}&token=${encodeURIComponent(token)}`,
    );
    // Poll until the user approves in the browser. Error 14 ("unauthorized
    // token") just means not-approved-yet; any other error aborts (the host
    // maps a throw to { ok: false, message }).
    const deadline = Date.now() + AUTH_POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await sleep(AUTH_POLL_INTERVAL_MS);
      let res: SessionResponse;
      try {
        res = await c.call<SessionResponse>("auth.getSession", { token });
      } catch (err) {
        if (isLastfmError(err, 14)) continue;
        throw err;
      }
      await ctx.secrets.set("sessionKey", res.session.key);
      await ctx.storage.set("username", res.session.name);
      await ctx.storage.set("connection", `Connected as ${res.session.name}`);
      ctx.ui.notify(`Connected to Last.fm as ${res.session.name}`);
      return { ok: true, message: `Connected as ${res.session.name}` };
    }
    return { ok: false, message: "Authorization not completed — try again" };
  });

  // ── Scrobbling (event subscribers; silent no-ops when not connected) ──────
  const scrobblingEnabled = async () => (await ctx.storage.get<boolean>("scrobbling")) !== false; // default on

  const onTrackStarted = async ({ track }: PluginEvents["trackStarted"]): Promise<void> => {
    const s = await session();
    if (!s || !(await scrobblingEnabled())) return;
    // Never retried, per last.fm guidance.
    await s.client.call("track.updateNowPlaying", trackParams(track), { sk: s.sk });
  };
  ctx.events.on("trackStarted", (payload) => {
    onTrackStarted(payload).catch((err) => ctx.log("updateNowPlaying failed:", errText(err)));
  });

  const onScrobble = async ({
    track,
    startedAtEpochSec,
  }: PluginEvents["scrobble"]): Promise<void> => {
    const s = await session();
    if (!s || !(await scrobblingEnabled())) return;
    await s.client.call(
      "track.scrobble",
      { ...trackParams(track), timestamp: String(startedAtEpochSec) },
      { sk: s.sk },
    );
  };
  ctx.events.on("scrobble", (payload) => {
    onScrobble(payload).catch((err) => {
      ctx.log("scrobble failed:", errText(err));
      ctx.ui.notify(`Last.fm scrobble failed: ${errText(err)}`, "error");
    });
  });

  // ── "Love on Last.fm" track action ────────────────────────────────────────
  ctx.ui.contributeTrackAction({
    id: "lastfm-love",
    label: "Love on Last.fm",
    icon: "heart",
    onInvoke: async (track) => {
      const s = await session();
      if (!s) {
        ctx.ui.notify("Connect your Last.fm account first (Settings → Plugins)", "error");
        return;
      }
      try {
        await s.client.call(
          "track.love",
          { artist: track.artistName, track: track.title },
          { sk: s.sk },
        );
        ctx.ui.notify(`Loved "${track.title}" on Last.fm`);
      } catch (err) {
        ctx.ui.notify(`Last.fm love failed: ${errText(err)}`, "error");
      }
    },
  });
}
