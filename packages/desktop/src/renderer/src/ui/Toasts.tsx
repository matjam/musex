import { X } from "lucide-react";
import { useEffect, useState } from "react";
import type { PluginNotification } from "../../../shared/ipc-contract";

const TOAST_MS = 4000;
let nextToastId = 1;

/** Stack of plugin notifications pushed from main (`ui.notify`). Fixed
 *  bottom-right, above the now-playing bar, outside the topbar drag region. */
export function Toasts() {
  const [toasts, setToasts] = useState<{ id: number; n: PluginNotification }[]>([]);

  useEffect(() => {
    return window.musex.onPluginNotify((n) => {
      const id = nextToastId++;
      setToasts((t) => [...t, { id, n }]);
      window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), TOAST_MS);
    });
  }, []);

  if (toasts.length === 0) return null;
  return (
    <div className="toasts">
      {toasts.map(({ id, n }) => (
        <div key={id} className={`toast${n.level === "error" ? " toast--error" : ""}`}>
          <div className="toast-text">
            <div className="toast-source">{n.pluginId}</div>
            <div className="toast-msg">{n.message}</div>
          </div>
          <button
            type="button"
            className="toast-x"
            aria-label="Dismiss notification"
            onClick={() => setToasts((t) => t.filter((x) => x.id !== id))}
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
