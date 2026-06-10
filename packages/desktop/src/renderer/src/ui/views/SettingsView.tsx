import { Fragment, useCallback, useEffect, useState } from "react";
import type {
  CacheStats,
  PluginInfo,
  PluginSettings,
  SettingField,
  SettingsActionResult,
} from "../../../../shared/ipc-contract";
import { useApp } from "../../state/app";
import { formatBytes } from "../../util/format";
import { SHORTCUT_GROUPS } from "../hooks/useKeyboardShortcuts";

const GiB = 1024 ** 3;

type LoadState = { status: "loading" } | { status: "ready"; cacheEnabled: boolean; capGiB: number };

export function SettingsView() {
  const { library } = useApp();
  const [state, setState] = useState<LoadState>({ status: "loading" });
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
    <div className="settings-page">
      <h2 className="settings-head">Settings</h2>
      <div className="settings-subhead">Configure musex.</div>

      <div className="settings-section">
        <div className="settings-section-title">Local Cache</div>

        <div className="settings-row">
          <div className="settings-row-text">
            <div className="settings-row-label">Cache played tracks on this Mac</div>
            <div className="settings-row-desc">
              Audio files are saved to disk as they play and loaded locally next time, so repeat
              listens don't re-stream from Plex. Only original (direct-play) files are cached.
              Artwork is always cached regardless of this setting.
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

      <PluginsSection />

      <KeyboardShortcutsSection />

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
    </div>
  );
}

function KeyboardShortcutsSection() {
  return (
    <div className="settings-section">
      <div className="settings-section-title">Keyboard Shortcuts</div>
      {SHORTCUT_GROUPS.map((group) => (
        <Fragment key={group.title}>
          <div className="settings-kbd-group-title">{group.title}</div>
          {group.items.map((item) => (
            <div className="settings-row settings-kbd-row" key={item.combo}>
              <div className="settings-row-text">
                <div className="settings-row-label">{item.label}</div>
              </div>
              <kbd className="settings-kbd">{item.combo}</kbd>
            </div>
          ))}
        </Fragment>
      ))}
    </div>
  );
}

function statusChip(p: PluginInfo) {
  return <span className={`plugin-chip plugin-chip--${p.status}`}>{p.status}</span>;
}

function PluginsSection() {
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

  return (
    <div className="settings-section">
      <div className="settings-section-title">Plugins</div>
      <div className="settings-row">
        <div className="settings-row-text">
          <div className="settings-row-label">Installed plugins</div>
          <div className="settings-row-desc">
            Plugins are folders containing a plugin.json and an ESM entry. Drop one into the app's
            plugins directory and reload.
          </div>
        </div>
        <button
          type="button"
          className="settings-btn"
          disabled={reloading}
          onClick={() => void reload()}
        >
          {reloading ? "Reloading…" : "Reload plugins"}
        </button>
      </div>
      {plugins === null ? (
        <div className="settings-row">
          <div className="settings-row-text">
            <div className="settings-row-desc">Loading plugins…</div>
          </div>
        </div>
      ) : plugins.length === 0 ? (
        <div className="settings-row">
          <div className="settings-row-text">
            <div className="settings-row-desc">No plugins installed.</div>
          </div>
        </div>
      ) : (
        plugins.map((p) => <PluginCard key={p.id} plugin={p} onChanged={refresh} />)
      )}
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
        {field.help ? <div className="settings-row-desc">{field.help}</div> : null}
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
        {field.help ? <div className="settings-row-desc">{field.help}</div> : null}
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
        {field.help ? <div className="settings-row-desc">{field.help}</div> : null}
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
