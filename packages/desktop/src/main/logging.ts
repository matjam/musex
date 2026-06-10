import { inspect } from "node:util";
import type { LogEntryDto, LogLevel } from "../shared/ipc-contract.js";

/** In-memory ring buffer holding both main- and renderer-process log lines,
 *  surfaced by Help → Show Logs. Nothing is written to disk. */
const MAX_ENTRIES = 5000;

export class LogBuffer {
  private entries: LogEntryDto[] = [];
  private readonly listeners = new Set<(e: LogEntryDto) => void>();

  append(entry: LogEntryDto): void {
    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) {
      this.entries.splice(0, this.entries.length - MAX_ENTRIES);
    }
    for (const listener of this.listeners) listener(entry);
  }

  snapshot(): LogEntryDto[] {
    return [...this.entries];
  }

  /** Live-append subscription (drives the viewer's streaming updates). */
  onAppend(cb: (e: LogEntryDto) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
}

export const LOG_LEVELS: LogLevel[] = ["debug", "log", "info", "warn", "error"];

/** The app-wide buffer. A module singleton so the console tee can install at
 *  main's top level — before the Runtime or any window exists — and still be
 *  reachable from the IPC handlers. */
export const logBuffer = new LogBuffer();

function formatArgs(args: unknown[]): string {
  return args
    .map((a) => (typeof a === "string" ? a : inspect(a, { depth: 4, breakLength: 120 })))
    .join(" ");
}

/** Tee every console.* call in the main process into the buffer. Originals
 *  keep writing to stdio, so terminal output is unchanged. Install this at the
 *  very top of main so early startup logs are captured too. */
export function installConsoleTee(buffer: LogBuffer): void {
  for (const level of LOG_LEVELS) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      original(...args);
      buffer.append({ ts: Date.now(), source: "main", level, text: formatArgs(args) });
    };
  }
}
