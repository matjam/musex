import type { Library } from "@musex/core";
import { TRANSCODE_BITRATES } from "@musex/core";
import type { LucideIcon } from "lucide-react";
import { Blocks, HardDrive, Music2, Puzzle, Settings2, Sparkles, Volume2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_AUDIO_PREFS,
  EQ_PRESETS,
  type LevelingMode,
} from "../../../../logic/audio-filters";
import type {
  AudioPrefsDto,
  AvailablePluginDto,
  CacheStats,
  ExpansionStateDto,
  FetchManifestResultDto,
  LastfmConfigDto,
  PluginInfo,
  PluginSettings,
  SettingField,
  SettingsActionResult,
  StorageQualityDto,
} from "../../../../shared/ipc-contract";
import { useApp } from "../../state/app";
import { formatBytes } from "../../util/format";

declare const __APP_VERSION__: string;

const GiB = 1024 ** 3;

type CategoryId =
  | "general"
  | "playback"
  | "library"
  | "discovery"
  | "lastfm"
  | "plugins"
  | `plugin:${string}`;

const CATEGORIES: ReadonlyArray<{
  id: CategoryId;
  label: string;
  icon: LucideIcon;
}> = [
  { id: "general", label: "General", icon: Settings2 },
  { id: "playback", label: "Playback", icon: Volume2 },
  { id: "library", label: "Downloads & Storage", icon: HardDrive },
  { id: "discovery", label: "Discovery", icon: Sparkles },
  { id: "lastfm", label: "Last.fm", icon: Music2 },
  { id: "plugins", label: "Plugins", icon: Blocks },
];

function isKnownCategory(id: string | undefined): id is CategoryId {
  if (!id) return false;
  if ((CATEGORIES as ReadonlyArray<{ id: string }>).some((c) => c.id === id)) return true;
  return id.startsWith("plugin:");
}

/** Renders help text with any http(s) URLs as clickable links (opened in the
 *  default browser) so plugins can point at e.g. API-key signup pages. */
function HelpText({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s)]+)/g);
  return (
    <div className="settings-row-desc">
      {parts.map((part, i) =>
        /^https?:\/\//.test(part) ? (
          <button
            // biome-ignore lint/suspicious/noArrayIndexKey: static split of a constant string
            key={i}
            type="button"
            className="about-link"
            onClick={() => void window.musex.openExternal(part)}
          >
            {part}
          </button>
        ) : (
          part
        ),
      )}
    </div>
  );
}

/** Plex server / library info. */
function AccountSection() {
  const { library, dispatch } = useApp();
  const [libs, setLibs] = useState<Library[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    window.musex
      .discoverLibraries()
      .then((res) => {
        if (!alive) return;
        const sorted = res.libraries
          .slice()
          .sort((a, b) => Number(Boolean(b.owned)) - Number(Boolean(a.owned)));
        setLibs(sorted);
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  async function choose(lib: Library) {
    if (busy || lib.id === library?.id) return;
    setBusy(true);
    try {
      await window.musex.selectLibrary(lib.id);
      dispatch({ type: "library-switched", library: lib });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="settings-section">
      <div className="settings-section-title">Account</div>
      {loading ? (
        <div className="settings-row">
          <div className="settings-row-desc">Finding your libraries…</div>
        </div>
      ) : (
        libs.map((lib) => {
          const current = lib.id === library?.id && lib.serverId === library?.serverId;
          return (
            <div className="settings-row" key={`${lib.serverId}-${lib.id}`}>
              <div className="settings-row-text">
                <div className="settings-row-label">
                  {lib.serverName} · {lib.title}
                </div>
                <div className="settings-row-desc">
                  {lib.owned
                    ? "Your server"
                    : `Shared${lib.sourceTitle ? ` by ${lib.sourceTitle}` : ""}`}
                </div>
              </div>
              <button
                type="button"
                className="settings-btn"
                disabled={busy || current}
                onClick={() => void choose(lib)}
              >
                {current ? "Current" : "Use"}
              </button>
            </div>
          );
        })
      )}
    </div>
  );
}

/** Warning row shown when the OS keyring is unavailable and the Plex token is
 *  stored as plaintext. Fetches secureStorageAvailable from getPreferences.
 *  Renders nothing when secure storage is available (the common case on macOS). */
function SecurityWarningSection() {
  const [available, setAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    window.musex
      .getPreferences()
      .then((p) => {
        if (!cancelled) setAvailable(p.secureStorageAvailable);
      })
      .catch(() => {
        if (!cancelled) setAvailable(true); // assume available on error
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (available !== false) return null;

  return (
    <div className="settings-section">
      <div className="settings-row">
        <div className="settings-row-desc error-text">
          Secure storage unavailable — your Plex token is stored unencrypted. Install a keyring
          (gnome-keyring/kwallet) to enable encryption.
        </div>
      </div>
    </div>
  );
}

/** App version + manual update check. Results surface as native dialogs in
 *  main (same flow as the menu item), so no result plumbing here. */
function AppSection() {
  const [busy, setBusy] = useState(false);
  return (
    <div className="settings-section">
      <div className="settings-section-title">Application</div>
      <div className="settings-row">
        <div className="settings-row-text">
          <div className="settings-row-label">musex {__APP_VERSION__}</div>
          <div className="settings-row-desc">Updates install automatically when available.</div>
        </div>
        <button
          type="button"
          className="settings-btn"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void window.musex.updaterCheck().finally(() => setBusy(false));
          }}
        >
          {busy ? "Checking…" : "Check for Updates"}
        </button>
      </div>
    </div>
  );
}

/** Download storage quality: original file or MP3 at a chosen bitrate.
 *  Optimistic update — reverts on rejection, shows error-text. */
function StorageQualitySection() {
  const [quality, setQuality] = useState<StorageQualityDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    window.musex
      .storageGetQuality()
      .then((q) => {
        if (!cancelled) setQuality(q);
      })
      .catch(() => {
        if (!cancelled) setQuality({ mode: "original", bitrateKbps: 256 });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!quality) return null;

  async function applyQuality(next: StorageQualityDto) {
    const prev = quality;
    if (!prev) return;
    setQuality(next);
    setError(null);
    try {
      await window.musex.storageSetQuality(next);
    } catch (err) {
      setQuality(prev);
      setError(
        `Couldn't save download quality: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return (
    <div className="settings-section">
      <div className="settings-section-title">Download Quality</div>

      <div className="settings-row">
        <div className="settings-row-text">
          <div className="settings-row-label">Format</div>
          <div className="settings-row-desc">
            Downloads are saved in the chosen format. Live playback always streams the original file
            from Plex regardless of this setting.
          </div>
        </div>
        <select
          className="settings-input settings-input--select"
          aria-label="Download format"
          value={quality.mode}
          onChange={(e) =>
            void applyQuality({
              mode: e.target.value as StorageQualityDto["mode"],
              bitrateKbps: quality.bitrateKbps,
            })
          }
        >
          <option value="original">Original</option>
          <option value="mp3">MP3</option>
        </select>
      </div>

      {quality.mode === "mp3" ? (
        <div className="settings-row">
          <div className="settings-row-text">
            <div className="settings-row-label">Bitrate</div>
            <div className="settings-row-desc">
              MP3 is transcoded at this bitrate ceiling — files land at or below it.
            </div>
          </div>
          <select
            className="settings-input settings-input--select"
            aria-label="MP3 bitrate"
            value={quality.bitrateKbps}
            onChange={(e) =>
              void applyQuality({ mode: "mp3", bitrateKbps: Number(e.target.value) })
            }
          >
            {TRANSCODE_BITRATES.map((kbps) => (
              <option key={kbps} value={kbps}>
                {kbps} kbps
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {error ? (
        <div className="settings-row">
          <div className="settings-row-desc error-text">{error}</div>
        </div>
      ) : null}
    </div>
  );
}

function sumDownloadedBytes(records: { state: string; bytes: number }[]): number {
  return records.reduce((acc, r) => (r.state === "downloaded" ? acc + r.bytes : acc), 0);
}

/** Downloads size summary + remove-all button. Subscribes to live progress. */
function DownloadsSizeSection() {
  const [downloadedBytes, setDownloadedBytes] = useState<number | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    window.musex
      .downloadsList()
      .then((records) => {
        if (!cancelled) setDownloadedBytes(sumDownloadedBytes(records));
      })
      .catch(() => {
        if (!cancelled) setDownloadedBytes(0);
      });

    const unsub = window.musex.onDownloadsProgress(() => {
      // Re-fetch the full list on any progress event to recompute the total.
      window.musex
        .downloadsList()
        .then((records) => {
          if (!cancelled) setDownloadedBytes(sumDownloadedBytes(records));
        })
        .catch(() => {});
    });

    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  async function removeAll() {
    const confirmed = window.confirm(
      "Remove all downloaded tracks? The files will be deleted from this device.",
    );
    if (!confirmed) return;
    setRemoving(true);
    setRemoveError(null);
    try {
      const records = await window.musex.downloadsList();
      const downloaded = records.filter((r) => r.state === "downloaded");
      await Promise.allSettled(downloaded.map((r) => window.musex.removeDownload(r.key)));
      const updated = await window.musex.downloadsList();
      setDownloadedBytes(sumDownloadedBytes(updated));
    } catch (err) {
      setRemoveError(err instanceof Error ? err.message : String(err));
    } finally {
      setRemoving(false);
    }
  }

  return (
    <div className="settings-section">
      <div className="settings-section-title">Downloaded Tracks</div>
      <div className="settings-row">
        <div className="settings-row-text">
          <div className="settings-row-label">Storage used</div>
          <div className="settings-row-desc">
            {downloadedBytes === null ? "—" : formatBytes(downloadedBytes)}
          </div>
          {removeError ? <div className="settings-row-desc error-text">{removeError}</div> : null}
        </div>
        <button
          type="button"
          className="settings-btn danger"
          disabled={removing || downloadedBytes === 0}
          onClick={() => void removeAll()}
        >
          {removing ? "Removing…" : "Remove all"}
        </button>
      </div>
    </div>
  );
}

type CacheLoadState =
  | { status: "loading" }
  | { status: "ready"; cacheEnabled: boolean; capGiB: number };

/** Local cache settings (previously inline in SettingsView). */
function CacheSection() {
  const [state, setState] = useState<CacheLoadState>({ status: "loading" });
  const [stats, setStats] = useState<CacheStats | null>(null);
  const [clearing, setClearing] = useState(false);

  function refreshStats() {
    window.musex
      .getCacheStats()
      .then(setStats)
      .catch(() => setStats(null));
  }

  useEffect(() => {
    let cancelled = false;
    window.musex
      .getPreferences()
      .then((p) => {
        if (!cancelled) {
          setState({
            status: "ready",
            cacheEnabled: p.cacheEnabled,
            capGiB: p.cacheMaxBytes / GiB,
          });
        }
      })
      .catch(() => {
        if (!cancelled) setState({ status: "ready", cacheEnabled: false, capGiB: 5 });
      });
    // Inline the stats fetch on mount to avoid a dependency on `refreshStats`.
    window.musex
      .getCacheStats()
      .then(setStats)
      .catch(() => setStats(null));
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status === "loading") {
    return <div className="content-placeholder">Loading settings…</div>;
  }

  async function toggleCache(enabled: boolean) {
    if (state.status !== "ready") return;
    setState({ ...state, cacheEnabled: enabled });
    await window.musex.setCacheEnabled(enabled);
  }

  function changeCap(nextGiB: number) {
    if (state.status !== "ready") return;
    const clamped = Number.isFinite(nextGiB) && nextGiB >= 1 ? nextGiB : 1;
    setState({ ...state, capGiB: clamped });
    void window.musex.setCacheMaxBytes(Math.round(clamped * GiB));
  }

  async function clearCache() {
    setClearing(true);
    try {
      await window.musex.clearCache();
      refreshStats();
    } finally {
      setClearing(false);
    }
  }

  return (
    <div className="settings-section">
      <div className="settings-section-title">Local Cache</div>

      <div className="settings-row">
        <div className="settings-row-text">
          <div className="settings-row-label">Cache played tracks on this Mac</div>
          <div className="settings-row-desc">
            Audio files are saved to disk as they play and loaded locally next time, so repeat
            listens don't re-stream from Plex. Only original (direct-play) files are cached. Artwork
            is always cached regardless of this setting.
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={state.cacheEnabled}
          aria-label="Cache played tracks"
          className={`toggle${state.cacheEnabled ? " toggle--on" : ""}`}
          onClick={() => void toggleCache(!state.cacheEnabled)}
        >
          <span className="toggle-knob" />
        </button>
      </div>

      <div className="settings-row">
        <div className="settings-row-text">
          <div className="settings-row-label">Maximum cache size</div>
          <div className="settings-row-desc">
            When the cache grows past this size, the least-recently-played files are removed
            automatically.
          </div>
        </div>
        <div>
          <input
            className="settings-input"
            type="number"
            min={1}
            step={1}
            value={state.capGiB}
            disabled={!state.cacheEnabled}
            onChange={(e) => changeCap(Number(e.target.value))}
          />
          <span className="settings-suffix">GB</span>
        </div>
      </div>

      <div className="settings-row">
        <div className="settings-row-text">
          <div className="settings-row-label">Current cache</div>
          <div className="settings-row-desc">
            {stats
              ? `${formatBytes(stats.bytes)} across ${stats.files} file${stats.files === 1 ? "" : "s"}`
              : "—"}
          </div>
        </div>
        <button
          type="button"
          className="settings-btn danger"
          disabled={clearing || (stats?.files ?? 0) === 0}
          onClick={() => void clearCache()}
        >
          {clearing ? "Clearing…" : "Clear cache"}
        </button>
      </div>
    </div>
  );
}

const LEVELING_OPTIONS: ReadonlyArray<{ value: LevelingMode; label: string; desc: string }> = [
  { value: "off", label: "Off", desc: "Play tracks at their original volume." },
  {
    value: "replaygain",
    label: "ReplayGain",
    desc: "Use ReplayGain tags when present (album gain, so albums keep their dynamics). Untagged files play unchanged.",
  },
  {
    value: "auto",
    label: "Auto",
    desc: "Smooth out loudness differences in real time. Works on every file, no tags needed.",
  },
];

/** Volume leveling + EQ presets — applied to mpv instantly, persisted in main. */
function AudioSection() {
  const [prefs, setPrefs] = useState<AudioPrefsDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    window.musex
      .getAudioPrefs()
      .then((p) => {
        if (!cancelled) setPrefs(p);
      })
      .catch(() => {
        if (!cancelled) setPrefs(DEFAULT_AUDIO_PREFS);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!prefs) return null;

  async function apply(next: AudioPrefsDto) {
    const prev = prefs;
    if (!prev) return;
    setPrefs(next);
    setError(null);
    try {
      await window.musex.setAudioPrefs(next);
    } catch (err) {
      // mpv refused the filter change — revert the UI to what's still in force.
      setPrefs(prev);
      setError(
        `Couldn't apply audio settings: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  const levelingDesc = LEVELING_OPTIONS.find((o) => o.value === prefs.leveling)?.desc ?? "";

  return (
    <div className="settings-section">
      <div className="settings-section-title">Audio</div>

      <div className="settings-row">
        <div className="settings-row-text">
          <div className="settings-row-label">Volume leveling</div>
          <div className="settings-row-desc">{levelingDesc}</div>
        </div>
        <select
          className="settings-input settings-input--select"
          aria-label="Volume leveling"
          value={prefs.leveling}
          onChange={(e) => void apply({ ...prefs, leveling: e.target.value as LevelingMode })}
        >
          {LEVELING_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <div className="settings-row">
        <div className="settings-row-text">
          <div className="settings-row-label">Equalizer</div>
          <div className="settings-row-desc">Presets apply instantly to the playing track.</div>
        </div>
        <select
          className="settings-input settings-input--select"
          aria-label="Equalizer preset"
          value={prefs.eqPreset}
          onChange={(e) => void apply({ ...prefs, eqPreset: e.target.value })}
        >
          {EQ_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </div>

      {error ? (
        <div className="settings-row">
          <div className="settings-row-desc error-text">{error}</div>
        </div>
      ) : null}
    </div>
  );
}

/** Last.fm first-party service settings: API key, shared secret, Connect
 *  button, connection status, scrobbling + love-on-rating toggles. */
function LastfmSection() {
  const [cfg, setCfg] = useState<LastfmConfigDto | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [connectResult, setConnectResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  const refresh = useCallback(() => {
    window.musex
      .lastfmGetConfig()
      .then((c) => {
        setCfg(c);
        setApiKey(c.apiKey);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function saveApiKey() {
    if (!cfg || apiKey === cfg.apiKey) return;
    await window.musex.lastfmSetConfig({ apiKey });
    refresh();
  }

  async function saveApiSecret() {
    if (!apiSecret) return;
    await window.musex.lastfmSetConfig({ apiSecret });
    setApiSecret("");
    refresh();
  }

  async function connect() {
    setConnecting(true);
    setConnectResult(null);
    try {
      const result = await window.musex.lastfmConnect();
      setConnectResult(result);
      refresh();
    } catch (err) {
      setConnectResult({
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setConnecting(false);
    }
  }

  async function toggleScrobbling() {
    if (!cfg) return;
    await window.musex.lastfmSetConfig({ scrobbling: !cfg.scrobbling });
    refresh();
  }

  async function toggleLoveOnRating() {
    if (!cfg) return;
    await window.musex.lastfmSetConfig({ loveOnRating: !cfg.loveOnRating });
    refresh();
  }

  if (!cfg) return <div className="content-placeholder">Loading…</div>;

  return (
    <>
      <div className="settings-section">
        <div className="settings-section-title">API Credentials</div>

        <div className="settings-row">
          <div className="settings-row-text">
            <div className="settings-row-label">API key</div>
            <HelpText text="Sign in to last.fm in your browser, then create one at https://www.last.fm/api/account/create (leave callback URL blank)" />
          </div>
          <input
            className="settings-input settings-input--text"
            type="text"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            onBlur={() => void saveApiKey()}
          />
        </div>

        <div className="settings-row">
          <div className="settings-row-text">
            <div className="settings-row-label">Shared secret</div>
          </div>
          <input
            className="settings-input settings-input--text"
            type="password"
            value={apiSecret}
            placeholder={cfg.apiSecretSet ? "••••• (set)" : ""}
            onChange={(e) => setApiSecret(e.target.value)}
            onBlur={() => void saveApiSecret()}
          />
        </div>

        <div className="settings-row">
          <div className="settings-row-text">
            <div className="settings-row-label">Account connection</div>
            <div className="settings-row-desc">{cfg.connection}</div>
            {connectResult ? (
              <div className={`settings-row-desc${connectResult.ok ? "" : " error-text"}`}>
                {connectResult.message}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            className="settings-btn"
            disabled={connecting || !cfg.apiSecretSet || !cfg.apiKey}
            onClick={() => void connect()}
          >
            {connecting ? "Connecting…" : "Connect account"}
          </button>
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section-title">Scrobbling</div>

        <div className="settings-row">
          <div className="settings-row-text">
            <div className="settings-row-label">Scrobble plays</div>
            <div className="settings-row-desc">Report tracks to Last.fm as you listen.</div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={cfg.scrobbling}
            aria-label="Scrobble plays"
            className={`toggle${cfg.scrobbling ? " toggle--on" : ""}`}
            onClick={() => void toggleScrobbling()}
          >
            <span className="toggle-knob" />
          </button>
        </div>

        <div className="settings-row">
          <div className="settings-row-text">
            <div className="settings-row-label">Love tracks rated ★★★★ or more</div>
            <div className="settings-row-desc">
              Automatically love tracks when you rate them 4 stars or higher, and unlove when you
              rate them lower.
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={cfg.loveOnRating}
            aria-label="Love tracks rated 4 stars or more"
            className={`toggle${cfg.loveOnRating ? " toggle--on" : ""}`}
            onClick={() => void toggleLoveOnRating()}
          >
            <span className="toggle-knob" />
          </button>
        </div>
      </div>
    </>
  );
}

/** Taste expansion: opt-in optimistic acquisition. Toggle + weekly budget +
 *  the conservative→aggressive slider, a status line, and a manual run. */
function ExpansionSection() {
  const [state, setState] = useState<ExpansionStateDto | null>(null);
  const [running, setRunning] = useState(false);

  const refresh = useCallback(() => {
    window.musex
      .expansionGetState()
      .then(setState)
      .catch((err: unknown) => console.error("[expansion] state failed:", err));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function save(prefs: ExpansionStateDto["prefs"]) {
    setState((cur) => (cur ? { ...cur, prefs } : cur)); // optimistic
    await window.musex.expansionSetPrefs(prefs);
    refresh();
  }

  async function runNow() {
    setRunning(true);
    try {
      setState(await window.musex.expansionRunNow());
    } catch (err) {
      console.error("[expansion] run failed:", err);
    } finally {
      setRunning(false);
    }
  }

  if (state === null) return null;
  const { prefs, available } = state;
  const missing = [
    ...(available.similar ? [] : ["a similar-music plugin (last.fm)"]),
    ...(available.acquisition ? [] : ["an acquisition plugin"]),
  ];
  const statusLine = !prefs.enabled
    ? "Off — nothing is downloaded automatically."
    : missing.length > 0
      ? `Needs ${missing.join(" and ")} to run.`
      : state.lastSummary
        ? `Last cycle: ${state.lastSummary.toLowerCase()}${state.lastRunAt ? ` (${new Date(state.lastRunAt).toLocaleString()})` : ""}`
        : "Waiting for the first cycle.";

  return (
    <div className="settings-section">
      <div className="settings-section-title">Taste Expansion</div>

      <div className="settings-row">
        <div className="settings-row-text">
          <div className="settings-row-label">Discover and download music you might like</div>
          <div className="settings-row-desc">
            Picks new artists from your listening profile via last.fm and quietly adds an album
            through an acquisition plugin — a blend of close-to-your-taste and a step beyond it.
            Every attempt is visible in Downloads → Expansions.
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={prefs.enabled}
          aria-label="Taste expansion"
          className={`toggle${prefs.enabled ? " toggle--on" : ""}`}
          onClick={() => void save({ ...prefs, enabled: !prefs.enabled })}
        />
      </div>

      <div className="settings-row">
        <div className="settings-row-text">
          <div className="settings-row-label">Weekly budget</div>
          <div className="settings-row-desc">How many albums may be requested per week.</div>
        </div>
        <div className="expansion-budget">
          <input
            type="range"
            min={1}
            max={10}
            step={1}
            value={prefs.albumsPerWeek}
            aria-label="Albums per week"
            className="settings-range"
            onChange={(e) => void save({ ...prefs, albumsPerWeek: Number(e.target.value) })}
          />
          <span className="expansion-budget-value">{prefs.albumsPerWeek}/week</span>
        </div>
      </div>

      <div className="settings-row">
        <div className="settings-row-text">
          <div className="settings-row-label">Adventurousness</div>
          <div className="settings-row-desc">
            Conservative sticks close to artists you already love; aggressive bets further afield
            and deepens winners faster.
          </div>
        </div>
        <div className="expansion-slider">
          <span className="expansion-slider-label">Conservative</span>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={prefs.aggressiveness}
            aria-label="Adventurousness"
            className="settings-range"
            onChange={(e) => void save({ ...prefs, aggressiveness: Number(e.target.value) })}
          />
          <span className="expansion-slider-label">Aggressive</span>
        </div>
      </div>

      <div className="settings-row">
        <div className="settings-row-text">
          <div className="settings-row-label">Status</div>
          <div className="settings-row-desc">{statusLine}</div>
        </div>
        <button
          type="button"
          className="settings-btn"
          disabled={running || !prefs.enabled}
          onClick={() => void runNow()}
        >
          {running ? "Running…" : "Run a cycle now"}
        </button>
      </div>
    </div>
  );
}

function statusChip(p: PluginInfo) {
  return <span className={`plugin-chip plugin-chip--${p.status}`}>{p.status}</span>;
}

/** A single available-plugin row from a fetched manifest. */
function AvailablePluginRow({
  plugin,
  busy,
  onInstall,
}: {
  plugin: AvailablePluginDto;
  busy: boolean;
  onInstall: (plugin: AvailablePluginDto) => void;
}) {
  const isInstalled =
    plugin.installedVersion !== undefined && plugin.installedVersion === plugin.version;
  const hasUpdate =
    plugin.installedVersion !== undefined && plugin.installedVersion !== plugin.version;

  let actionLabel: string;
  let actionDisabled: boolean;
  if (!plugin.compatible) {
    actionLabel = "Needs newer app";
    actionDisabled = true;
  } else if (isInstalled) {
    actionLabel = "Installed";
    actionDisabled = true;
  } else if (hasUpdate) {
    actionLabel = busy ? "Updating…" : "Update";
    actionDisabled = busy;
  } else {
    actionLabel = busy ? "Installing…" : "Install";
    actionDisabled = busy;
  }

  return (
    <div className="settings-row">
      <div className="settings-row-text">
        <div className="settings-row-label">
          {plugin.name} <span className="plugin-version">v{plugin.version}</span>
          {plugin.installedVersion !== undefined ? (
            <span className="plugin-chip plugin-chip--active">
              {hasUpdate ? `installed v${plugin.installedVersion}` : "installed"}
            </span>
          ) : null}
        </div>
        {plugin.description ? <div className="settings-row-desc">{plugin.description}</div> : null}
        {!plugin.compatible ? (
          <div className="settings-row-desc error-text">
            Requires plugin API v{plugin.apiVersion} — update the app to install.
          </div>
        ) : null}
      </div>
      <button
        type="button"
        className="settings-btn"
        disabled={actionDisabled}
        onClick={() => onInstall(plugin)}
      >
        {actionLabel}
      </button>
    </div>
  );
}

/** Overview pane: reload row + "Add from GitHub" install section + per-user-plugin
 *  enable toggles + status chips.  Core plugins appear as their own nav entries
 *  above Plugins; this pane covers user plugins only.
 *  Settings fields are NOT shown here — use the plugin:<id> sub-entry for that. */
function PluginsOverview({
  plugins,
  reloading,
  onReload,
  onChanged,
}: {
  plugins: PluginInfo[] | null;
  reloading: boolean;
  onReload: () => void;
  onChanged: () => void;
}) {
  const [repoUrl, setRepoUrl] = useState("");
  const [available, setAvailable] = useState<FetchManifestResultDto | null>(null);
  const [browsing, setBrowsing] = useState(false);
  const [browseError, setBrowseError] = useState<string | null>(null);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);

  async function browse() {
    if (!repoUrl.trim()) return;
    setBrowsing(true);
    setBrowseError(null);
    setAvailable(null);
    setInstallError(null);
    try {
      const result = await window.musex.pluginsFetchManifest(repoUrl.trim());
      setAvailable(result);
    } catch (err) {
      setBrowseError(err instanceof Error ? err.message : String(err));
    } finally {
      setBrowsing(false);
    }
  }

  async function install(plugin: AvailablePluginDto) {
    if (!available) return;
    const repo = available.repo;
    const confirmed = window.confirm(
      `Plugins run sandboxed — they can't touch your files, system, or Plex account. But they can make network requests and use any settings or credentials you give them, so only install plugins you trust.\n\nInstall ${plugin.name} from ${repo}?`,
    );
    if (!confirmed) return;
    setInstallingId(plugin.id);
    setInstallError(null);
    try {
      await window.musex.pluginsInstall(repoUrl.trim(), plugin.id);
      onChanged();
      // Re-browse to refresh installed versions in the list.
      const result = await window.musex.pluginsFetchManifest(repoUrl.trim());
      setAvailable(result);
    } catch (err) {
      setInstallError(err instanceof Error ? err.message : String(err));
    } finally {
      setInstallingId(null);
    }
  }

  const userPlugins = plugins === null ? null : plugins.filter((p) => p.origin === "user");
  return (
    <>
      <div className="settings-section">
        <div className="settings-section-title">Add from GitHub</div>
        <div className="settings-row">
          <div className="settings-row-text">
            <div className="settings-row-label">Plugin repository</div>
            <div className="settings-row-desc">
              Paste a GitHub repo URL or owner/repo shorthand, then browse to see what's available.
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              className="settings-input settings-input--text"
              type="text"
              placeholder="owner/repo or GitHub URL"
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void browse();
              }}
            />
            <button
              type="button"
              className="settings-btn"
              disabled={browsing || !repoUrl.trim()}
              onClick={() => void browse()}
            >
              {browsing ? "Browsing…" : "Browse"}
            </button>
          </div>
        </div>
        {browseError ? (
          <div className="settings-row">
            <div className="settings-row-desc error-text">{browseError}</div>
          </div>
        ) : null}
        {installError ? (
          <div className="settings-row">
            <div className="settings-row-desc error-text">{installError}</div>
          </div>
        ) : null}
        {available !== null ? (
          available.plugins.length === 0 ? (
            <div className="settings-row">
              <div className="settings-row-text">
                <div className="settings-row-desc">No plugins found in this repository.</div>
              </div>
            </div>
          ) : (
            available.plugins.map((p) => (
              <AvailablePluginRow
                key={p.id}
                plugin={p}
                busy={installingId === p.id}
                onInstall={(plugin) => void install(plugin)}
              />
            ))
          )
        ) : null}
      </div>
      <div className="settings-section">
        <div className="settings-section-title">Installed plugins</div>
        <div className="settings-row">
          <div className="settings-row-text">
            <div className="settings-row-label">Manage plugins</div>
            <div className="settings-row-desc">
              User plugins are folders containing a plugin.json and an ESM entry dropped into the
              app's plugins directory. They run sandboxed (no file or system access) and reach the
              app only through the plugin API. Reload to pick up changes.
            </div>
          </div>
          <button type="button" className="settings-btn" disabled={reloading} onClick={onReload}>
            {reloading ? "Reloading…" : "Reload plugins"}
          </button>
        </div>
        {userPlugins === null ? (
          <div className="settings-row">
            <div className="settings-row-text">
              <div className="settings-row-desc">Loading plugins…</div>
            </div>
          </div>
        ) : userPlugins.length === 0 ? (
          <div className="settings-row">
            <div className="settings-row-text">
              <div className="settings-row-desc">No plugins installed.</div>
            </div>
          </div>
        ) : (
          userPlugins.map((p) => <PluginsOverviewRow key={p.id} plugin={p} onChanged={onChanged} />)
        )}
      </div>
    </>
  );
}

/** A single plugin row in the overview: name/version/status chip + enable toggle + uninstall. */
function PluginsOverviewRow({ plugin, onChanged }: { plugin: PluginInfo; onChanged: () => void }) {
  const enabled = plugin.status !== "disabled";
  const [uninstalling, setUninstalling] = useState(false);

  async function toggleEnabled() {
    await window.musex.pluginsSetEnabled(plugin.id, !enabled);
    onChanged();
  }

  async function uninstall() {
    const confirmed = window.confirm(`Remove ${plugin.name}? This cannot be undone.`);
    if (!confirmed) return;
    setUninstalling(true);
    try {
      await window.musex.pluginsUninstall(plugin.id);
      onChanged();
    } catch (err) {
      console.error("[plugins] uninstall failed:", err);
    } finally {
      setUninstalling(false);
    }
  }

  return (
    <div className="settings-row">
      <div className="settings-row-text">
        <div className="settings-row-label">
          {plugin.name} <span className="plugin-version">v{plugin.version}</span>
          {statusChip(plugin)}
        </div>
        {plugin.error ? <div className="settings-row-desc plugin-error">{plugin.error}</div> : null}
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        {plugin.origin === "user" ? (
          <button
            type="button"
            className="settings-btn danger"
            disabled={uninstalling}
            onClick={() => void uninstall()}
          >
            {uninstalling ? "Removing…" : "Uninstall"}
          </button>
        ) : null}
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label={`Enable ${plugin.name}`}
          className={`toggle${enabled ? " toggle--on" : ""}`}
          disabled={plugin.status === "incompatible"}
          onClick={() => void toggleEnabled()}
        >
          <span className="toggle-knob" />
        </button>
      </div>
    </div>
  );
}

function PluginCard({ plugin, onChanged }: { plugin: PluginInfo; onChanged: () => void }) {
  const [settings, setSettings] = useState<PluginSettings | null>(null);
  const enabled = plugin.status !== "disabled";

  const refreshSettings = useCallback(() => {
    if (plugin.status !== "active") {
      setSettings(null);
      return;
    }
    window.musex
      .pluginsGetSettings(plugin.id)
      .then(setSettings)
      .catch(() => setSettings(null));
  }, [plugin.id, plugin.status]);

  useEffect(() => {
    refreshSettings();
  }, [refreshSettings]);

  async function toggleEnabled() {
    await window.musex.pluginsSetEnabled(plugin.id, !enabled);
    onChanged();
  }

  return (
    <>
      <div className="settings-row">
        <div className="settings-row-text">
          <div className="settings-row-label">
            {plugin.name} <span className="plugin-version">v{plugin.version}</span>
            {statusChip(plugin)}
          </div>
          {plugin.error ? (
            <div className="settings-row-desc plugin-error">{plugin.error}</div>
          ) : null}
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label={`Enable ${plugin.name}`}
          className={`toggle${enabled ? " toggle--on" : ""}`}
          disabled={plugin.status === "incompatible"}
          onClick={() => void toggleEnabled()}
        >
          <span className="toggle-knob" />
        </button>
      </div>
      {settings
        ? settings.schema.map((field) => (
            <PluginSettingRow
              key={field.key}
              pluginId={plugin.id}
              field={field}
              value={settings.values[field.key]}
              onSaved={refreshSettings}
            />
          ))
        : null}
    </>
  );
}

function PluginSettingRow({
  pluginId,
  field,
  value,
  onSaved,
}: {
  pluginId: string;
  field: SettingField;
  value: unknown;
  onSaved: () => void;
}) {
  if (field.kind === "status") {
    return (
      <div className="settings-row plugin-setting-row">
        <div className="settings-row-text">
          <div className="settings-row-desc">{typeof value === "string" ? value : "—"}</div>
        </div>
      </div>
    );
  }
  if (field.kind === "toggle") {
    return <PluginToggleRow pluginId={pluginId} field={field} value={value} onSaved={onSaved} />;
  }
  if (field.kind === "action") {
    return <PluginActionRow pluginId={pluginId} field={field} onSaved={onSaved} />;
  }
  return <PluginTextRow pluginId={pluginId} field={field} value={value} onSaved={onSaved} />;
}

type LabeledField = Exclude<SettingField, { kind: "status" }>;

function PluginToggleRow({
  pluginId,
  field,
  value,
  onSaved,
}: {
  pluginId: string;
  field: LabeledField;
  value: unknown;
  onSaved: () => void;
}) {
  const on = Boolean(value);
  async function toggle() {
    await window.musex.pluginsSetSetting(pluginId, field.key, !on);
    onSaved();
  }
  return (
    <div className="settings-row plugin-setting-row">
      <div className="settings-row-text">
        <div className="settings-row-label">{field.label}</div>
        {field.help ? <HelpText text={field.help} /> : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={field.label}
        className={`toggle${on ? " toggle--on" : ""}`}
        onClick={() => void toggle()}
      >
        <span className="toggle-knob" />
      </button>
    </div>
  );
}

function PluginActionRow({
  pluginId,
  field,
  onSaved,
}: {
  pluginId: string;
  field: LabeledField;
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SettingsActionResult | null>(null);

  async function run() {
    setBusy(true);
    setResult(null);
    try {
      setResult(await window.musex.pluginsSettingsAction(pluginId, field.key));
    } catch (err) {
      setResult({ ok: false, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
    onSaved(); // the action may have updated status/storage fields
  }

  return (
    <div className="settings-row plugin-setting-row">
      <div className="settings-row-text">
        <div className="settings-row-label">{field.label}</div>
        {field.help ? <HelpText text={field.help} /> : null}
      </div>
      <div>
        {result?.message ? (
          <span
            className={`plugin-action-result${result.ok ? "" : " plugin-action-result--error"}`}
          >
            {result.message}
          </span>
        ) : null}
        <button type="button" className="settings-btn" disabled={busy} onClick={() => void run()}>
          {busy ? "Working…" : field.label}
        </button>
      </div>
    </div>
  );
}

function PluginTextRow({
  pluginId,
  field,
  value,
  onSaved,
}: {
  pluginId: string;
  field: LabeledField;
  value: unknown;
  onSaved: () => void;
}) {
  const isPassword = field.kind === "password";
  const saved = !isPassword && typeof value === "string" ? value : "";
  const isSet = isPassword && Boolean((value as { set?: boolean } | null | undefined)?.set);
  const [draft, setDraft] = useState(saved);

  // Re-sync when the persisted value changes (e.g. after a settings action).
  useEffect(() => {
    if (!isPassword) setDraft(saved);
  }, [saved, isPassword]);

  async function save() {
    if (isPassword) {
      if (draft === "") return; // an empty blur never wipes a stored secret
      await window.musex.pluginsSetSetting(pluginId, field.key, draft);
      setDraft("");
    } else {
      if (draft === saved) return;
      await window.musex.pluginsSetSetting(pluginId, field.key, draft);
    }
    onSaved();
  }

  return (
    <div className="settings-row plugin-setting-row">
      <div className="settings-row-text">
        <div className="settings-row-label">{field.label}</div>
        {field.help ? <HelpText text={field.help} /> : null}
      </div>
      <input
        className="settings-input settings-input--text"
        type={isPassword ? "password" : "text"}
        value={draft}
        placeholder={isSet ? "••••• (set)" : ""}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void save()}
      />
    </div>
  );
}

export function SettingsView({ initialCategory }: { initialCategory?: string } = {}) {
  const [category, setCategory] = useState<string>(() =>
    isKnownCategory(initialCategory) ? initialCategory : "general",
  );

  // A deep-link arriving while the modal is already open switches the pane
  // (the useState initializer above only covers mount).
  useEffect(() => {
    if (isKnownCategory(initialCategory)) setCategory(initialCategory);
  }, [initialCategory]);

  const [plugins, setPlugins] = useState<PluginInfo[] | null>(null);
  const [reloading, setReloading] = useState(false);

  const refresh = useCallback(() => {
    window.musex
      .pluginsList()
      .then(setPlugins)
      .catch(() => setPlugins([]));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function reload() {
    setReloading(true);
    try {
      await window.musex.pluginsReload();
      refresh();
    } finally {
      setReloading(false);
    }
  }

  const corePlugins = (plugins ?? []).filter((p) => p.origin === "core");
  const userPlugins = (plugins ?? []).filter((p) => p.origin === "user");

  return (
    <div className="settings-layout">
      <nav className="settings-nav">
        {CATEGORIES.slice(
          0,
          CATEGORIES.findIndex((c) => c.id === "plugins"),
        ).map((c) => (
          <button
            key={c.id}
            type="button"
            className={`nav-item${category === c.id ? " active" : ""}`}
            onClick={() => setCategory(c.id)}
          >
            <c.icon size={16} />
            {c.label}
          </button>
        ))}
        {corePlugins.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`nav-item${category === `plugin:${p.id}` ? " active" : ""}`}
            onClick={() => setCategory(`plugin:${p.id}`)}
          >
            <Puzzle size={16} />
            {p.name}
          </button>
        ))}
        {CATEGORIES.slice(CATEGORIES.findIndex((c) => c.id === "plugins")).map((c) => (
          <button
            key={c.id}
            type="button"
            className={`nav-item${category === c.id ? " active" : ""}`}
            onClick={() => setCategory(c.id)}
          >
            <c.icon size={16} />
            {c.label}
          </button>
        ))}
        {userPlugins.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`nav-item settings-nav-sub${category === `plugin:${p.id}` ? " active" : ""}`}
            onClick={() => setCategory(`plugin:${p.id}`)}
          >
            <Puzzle size={14} />
            {p.name}
          </button>
        ))}
      </nav>
      <div className="settings-pane">
        <div className="settings-page">
          {category === "general" && (
            <>
              <SecurityWarningSection />
              <AccountSection />
              <AppSection />
            </>
          )}
          {category === "playback" && <AudioSection />}
          {category === "library" && (
            <>
              <StorageQualitySection />
              <DownloadsSizeSection />
              <CacheSection />
            </>
          )}
          {category === "discovery" && <ExpansionSection />}
          {category === "lastfm" && <LastfmSection />}
          {category === "plugins" && (
            <PluginsOverview
              plugins={plugins}
              reloading={reloading}
              onReload={() => void reload()}
              onChanged={refresh}
            />
          )}
          {category.startsWith("plugin:") &&
            (() => {
              if (plugins === null) {
                return <div className="content-placeholder">Loading plugins…</div>;
              }
              const p = plugins.find((x) => `plugin:${x.id}` === category);
              return p ? (
                <div className="settings-section">
                  <div className="settings-section-title">{p.name}</div>
                  <PluginCard plugin={p} onChanged={refresh} />
                </div>
              ) : (
                <div className="content-placeholder">Plugin not found.</div>
              );
            })()}
        </div>
      </div>
    </div>
  );
}
