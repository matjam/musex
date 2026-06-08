import { useEffect, useState } from "react";
import type { CacheStats } from "../../../../shared/ipc-contract";
import { useApp } from "../../state/app";
import { formatBytes } from "../../util/format";

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
              Songs are saved to disk as they play and loaded locally next time, so repeat listens
              don't re-stream from Plex. Only original (direct-play) files are cached.
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
