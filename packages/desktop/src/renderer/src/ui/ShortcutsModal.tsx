import { X } from "lucide-react";
import { useEffect } from "react";
import { SHORTCUT_GROUPS } from "./hooks/useKeyboardShortcuts";

/** Keyboard-shortcuts reference as a centered modal (⌘/ or Help menu).
 *  Rendered from the same SHORTCUT_GROUPS table the handler uses, so the
 *  reference can't drift from the behavior. Esc / backdrop / X close it. */
export function ShortcutsModal({ onClose }: { onClose: () => void }) {
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
        className="shortcuts-modal"
        role="dialog"
        aria-label="Keyboard shortcuts"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shortcuts-modal-head">
          <span className="shortcuts-modal-title">Keyboard Shortcuts</span>
          <button type="button" className="detail-close" title="Close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="shortcuts-modal-body">
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.title} className="shortcuts-modal-group">
              <div className="settings-kbd-group-title">{group.title}</div>
              {group.items.map((item) => (
                <div key={item.combo} className="settings-kbd-row">
                  <span>{item.label}</span>
                  <kbd className="settings-kbd">{item.combo}</kbd>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
