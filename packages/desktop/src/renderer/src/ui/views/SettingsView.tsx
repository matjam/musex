import type { LucideIcon } from "lucide-react";
import { Blocks, HardDrive, Puzzle, Settings2, Sparkles, Volume2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_AUDIO_PREFS,
  EQ_PRESETS,
  type LevelingMode,
} from "../../../../logic/audio-filters";
import type {
  AudioPrefsDto,
  CacheStats,
  ExpansionStateDto,
  PluginInfo,
  PluginSettings,
  SettingField,
  SettingsActionResult,
} from "../../../../shared/ipc-contract";
import { useApp } from "../../state/app";
import { formatBytes } from "../../util/format";

declare const __APP_VERSION__: string;

const GiB = 1024 ** 3;

type CategoryId = "general" | "playback" | "library" | "discovery" | "plugins" | `plugin:${string}`;

const CATEGORIES: ReadonlyArray<{
  id: CategoryId;
  label: string;
  icon: LucideIcon;
}> = [
  { id: "general", label: "General", icon: Settings2 },
  { id: "playback", label: "Playback", icon: Volume2 },
  { id: "library", label: "Library & Cache", icon: HardDrive },
  { id: "discovery", label: "Discovery", icon: Sparkles },
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
  const { library } = useApp();
  return (
    <div className="settings-section">
      <div className="settings-section-title">Account</div>
      <div className="settings-row">
        <div className="settings-row-text">
          <div className="settings-row-label">Plex server</div>
          <div className="settings-row-desc">
            {library ? `${library.serverName} · ${library.title}` : "No library selected"}
          </div>
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
    ...(available.acquisition ? [] : ["an acquisition plugin (Lidarr)"]),
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
            through Lidarr — a blend of close-to-your-taste and a step beyond it. Every attempt is
            visible in Downloads → Expansions.
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

/** Overview pane: reload row + per-user-plugin enable toggles + status chips.
 *  Core plugins appear as their own nav entries above Plugins; this pane covers
 *  user plugins only — folders dropped into the app's plugins directory.
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
  const userPlugins = plugins === null ? null : plugins.filter((p) => p.origin === "user");
  return (
    <div className="settings-section">
      <div className="settings-section-title">Plugins</div>
      <div className="settings-row">
        <div className="settings-row-text">
          <div className="settings-row-label">Installed plugins</div>
          <div className="settings-row-desc">
            User plugins are folders containing a plugin.json and an ESM entry dropped into the
            app's plugins directory. They run with full trust in the main process. Reload to pick up
            changes.
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
  );
}

/** A single plugin row in the overview: name/version/status chip + enable toggle. */
function PluginsOverviewRow({ plugin, onChanged }: { plugin: PluginInfo; onChanged: () => void }) {
  const enabled = plugin.status !== "disabled";

  async function toggleEnabled() {
    await window.musex.pluginsSetEnabled(plugin.id, !enabled);
    onChanged();
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
              <AccountSection />
              <AppSection />
            </>
          )}
          {category === "playback" && <AudioSection />}
          {category === "library" && <CacheSection />}
          {category === "discovery" && <ExpansionSection />}
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
