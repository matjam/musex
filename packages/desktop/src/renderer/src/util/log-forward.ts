import type { LogLevel, RendererLogEntry } from "../../../shared/ipc-contract";

const LEVELS: LogLevel[] = ["debug", "log", "info", "warn", "error"];
const FLUSH_MS = 250;
const MAX_QUEUED = 200;
const MAX_TEXT = 8192;

function formatArg(arg: unknown): string {
  if (typeof arg === "string") return arg;
  if (arg instanceof Error) return arg.stack ?? `${arg.name}: ${arg.message}`;
  try {
    return JSON.stringify(arg) ?? String(arg);
  } catch {
    return String(arg);
  }
}

/** Tee renderer console output (plus window errors / unhandled rejections)
 *  into main's unified log buffer, batched over IPC. Originals still write to
 *  DevTools. Call once, before the app renders. */
export function installLogForwarding(): void {
  let queue: RendererLogEntry[] = [];
  let scheduled = false;

  function flush(): void {
    scheduled = false;
    const batch = queue;
    queue = [];
    if (batch.length === 0) return;
    // Deliberately not logged on failure: reporting a log-forwarding error
    // through console would re-enter this hook and loop.
    window.musex.logsAppend(batch).catch(() => {});
  }

  function enqueue(level: LogLevel, args: unknown[]): void {
    queue.push({ ts: Date.now(), level, text: args.map(formatArg).join(" ").slice(0, MAX_TEXT) });
    if (queue.length > MAX_QUEUED) queue.splice(0, queue.length - MAX_QUEUED);
    if (!scheduled) {
      scheduled = true;
      setTimeout(flush, FLUSH_MS);
    }
  }

  for (const level of LEVELS) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      original(...args);
      enqueue(level, args);
    };
  }

  window.addEventListener("error", (e) => {
    enqueue("error", [`Uncaught: ${e.message} (${e.filename}:${e.lineno})`]);
  });
  window.addEventListener("unhandledrejection", (e) => {
    enqueue("error", ["Unhandled rejection:", e.reason]);
  });
}
