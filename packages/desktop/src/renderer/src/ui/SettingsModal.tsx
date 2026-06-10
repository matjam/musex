import { X } from "lucide-react";
import { useEffect } from "react";
import { SettingsView } from "./views/SettingsView";

/** Settings as a centered modal (musex menu → Settings…, ⌘,). The settings
 *  content itself lives in SettingsView; this is just the modal chrome. */
export function SettingsModal({ onClose }: { onClose: () => void }) {
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
        className="settings-modal"
        role="dialog"
        aria-label="Settings"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shortcuts-modal-head">
          <span className="shortcuts-modal-title">Settings</span>
          <button type="button" className="detail-close" title="Close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="settings-modal-body">
          <SettingsView />
        </div>
      </div>
    </div>
  );
}
