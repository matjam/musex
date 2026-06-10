import { Copy, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { LogEntryDto } from "../../../shared/ipc-contract";

const MAX_ROWS = 5000;

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

function toPlainText(entries: LogEntryDto[]): string {
  return entries.map((e) => `[${fmtTime(e.ts)}] [${e.source}] [${e.level}] ${e.text}`).join("\n");
}

/** Unified log viewer (Help → Show Logs): the main-process ring buffer —
 *  which already contains the renderer's forwarded console output — plus a
 *  live tail. Text is selectable; Copy grabs the whole buffer. */
export function LogsModal({ onClose }: { onClose: () => void }) {
  const [entries, setEntries] = useState<LogEntryDto[] | null>(null);
  const [copied, setCopied] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  // Stick to the bottom while the user hasn't scrolled up.
  const pinnedRef = useRef(true);

  useEffect(() => {
    let alive = true;
    window.musex
      .logsGet()
      .then((snapshot) => {
        if (alive) setEntries(snapshot);
      })
      .catch(() => {
        if (alive) setEntries([]);
      });
    const off = window.musex.onLogsEvent((entry) => {
      setEntries((cur) => (cur === null ? cur : [...cur.slice(-(MAX_ROWS - 1)), entry]));
    });
    return () => {
      alive = false;
      off();
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs on every entries change to keep the tail pinned
  useEffect(() => {
    const el = bodyRef.current;
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight;
  }, [entries]);

  function onScroll() {
    const el = bodyRef.current;
    if (!el) return;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  }

  function copyAll() {
    if (!entries) return;
    void navigator.clipboard.writeText(toPlainText(entries)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    // Keyboard dismissal is the window-level Escape listener above.
    // biome-ignore lint/a11y/noStaticElementInteractions: backdrop click-to-dismiss; the dialog itself is the interactive surface
    // biome-ignore lint/a11y/useKeyWithClickEvents: Escape (window listener) is the keyboard equivalent
    <div className="modal-backdrop" onClick={onClose}>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: stops backdrop dismissal from clicks inside the dialog */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: the click handler only stops propagation; no action to mirror */}
      <div
        className="logs-modal"
        role="dialog"
        aria-label="Logs"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shortcuts-modal-head">
          <span className="shortcuts-modal-title">Logs</span>
          <div className="logs-modal-actions">
            <button type="button" className="logs-copy-btn" onClick={copyAll}>
              <Copy size={13} />
              {copied ? "Copied" : "Copy"}
            </button>
            <button type="button" className="detail-close" title="Close" onClick={onClose}>
              <X size={16} />
            </button>
          </div>
        </div>
        <div className="logs-modal-body" ref={bodyRef} onScroll={onScroll}>
          {entries === null ? (
            <div className="logs-empty">Loading…</div>
          ) : entries.length === 0 ? (
            <div className="logs-empty">Nothing logged yet.</div>
          ) : (
            entries.map((e, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: append-only tail; rows are never reordered
              <div key={i} className={`logs-row logs-row--${e.level}`}>
                <span className="logs-time">{fmtTime(e.ts)}</span>
                <span className={`logs-source logs-source--${e.source}`}>{e.source}</span>
                <span className="logs-level">{e.level}</span>
                <span className="logs-text">{e.text}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
