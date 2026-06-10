import { ExternalLink, X } from "lucide-react";
import { useEffect, useState } from "react";

interface LicenseEntry {
  name: string;
  version: string;
  license: string;
  homepage: string | null;
  description: string | null;
  licenseText: string | null;
}

/** About window: version, copyright, MIT license, and a scrollable
 *  acknowledgements list of every dependency that ships in the app
 *  (generated/licenses.json — `pnpm gen:licenses`). The JSON is dynamically
 *  imported so the ~84KB of license texts stays out of the startup bundle. */
export function AboutModal({ onClose }: { onClose: () => void }) {
  const [deps, setDeps] = useState<LicenseEntry[] | null>(null);

  useEffect(() => {
    let alive = true;
    void import("../generated/licenses.json").then((m) => {
      if (alive) setDeps(m.default);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    // Keyboard dismissal is the window-level Escape listener above.
    // biome-ignore lint/a11y/noStaticElementInteractions: backdrop click-to-dismiss; the dialog itself is the interactive surface
    // biome-ignore lint/a11y/useKeyWithClickEvents: Escape (window listener) is the keyboard equivalent
    <div className="modal-backdrop" onClick={onClose}>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: stops backdrop dismissal from clicks inside the dialog */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: the click handler only stops propagation; no action to mirror */}
      <div
        className="about-modal"
        role="dialog"
        aria-label="About musex"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shortcuts-modal-head">
          <span className="shortcuts-modal-title">About musex</span>
          <button type="button" className="detail-close" title="Close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="about-modal-body">
          <div className="about-brand brand">
            mus<span>ex</span>
          </div>
          <div className="about-meta">Version {__APP_VERSION__}</div>
          <div className="about-meta">
            © 2026 Nathan Ollerenshaw · Released under the{" "}
            <button
              type="button"
              className="about-link"
              onClick={() => void window.musex.openExternal("https://opensource.org/license/mit")}
            >
              MIT License
            </button>
          </div>
          <div className="about-meta">
            <button
              type="button"
              className="about-link"
              onClick={() => void window.musex.openExternal("https://github.com/matjam/musex")}
            >
              github.com/matjam/musex
            </button>
          </div>

          <div className="about-section-title">Acknowledgements</div>
          <div className="about-blurb">
            musex is built on these open-source projects. Thank you to all of their authors and
            contributors.
          </div>
          {deps === null ? (
            <div className="about-meta">Loading…</div>
          ) : (
            deps.map((dep) => (
              <div key={dep.name} className="about-dep">
                <div className="about-dep-head">
                  <span className="about-dep-name">{dep.name}</span>
                  <span className="about-dep-version">{dep.version}</span>
                  <span className="about-dep-license">{dep.license}</span>
                  {dep.homepage && (
                    <button
                      type="button"
                      className="about-link about-dep-home"
                      title={dep.homepage}
                      onClick={() => {
                        if (dep.homepage) void window.musex.openExternal(dep.homepage);
                      }}
                    >
                      <ExternalLink size={12} />
                    </button>
                  )}
                </div>
                {dep.description && <div className="about-dep-desc">{dep.description}</div>}
                {dep.licenseText && (
                  <details className="about-dep-text">
                    <summary>License text</summary>
                    <pre>{dep.licenseText}</pre>
                  </details>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
