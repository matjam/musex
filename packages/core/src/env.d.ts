// Minimal ambient declarations for universally-available globals.
// @musex/core targets ES2022 without dom/node lib entries to stay platform-agnostic.
// These globals exist in every runtime this package runs in (Node, browser, Electron).

declare const console: {
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  log(...args: unknown[]): void;
  info(...args: unknown[]): void;
};
