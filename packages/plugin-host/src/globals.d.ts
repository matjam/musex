/** Host globals the plugin host relies on across every target platform
 *  (Node, Electron main, React Native/Hermes, the WebView harness). Declared
 *  by hand instead of pulling in `@types/node` or the DOM lib, so the package
 *  stays platform-agnostic: the root export (ProviderHub, registerHubProxies)
 *  must never depend on a specific host runtime. `/sandbox` adds quickjs on top
 *  of these, nothing else.
 *
 *  This also covers the host globals used by the `@musex/core` TS source the
 *  package imports (URL/URLSearchParams/structuredClone) — core's own
 *  globals.d.ts is outside this package's include, so re-declare them here. */

declare class URLSearchParams {
  constructor(init?: string | Record<string, string> | [string, string][]);
  append(name: string, value: string): void;
  get(name: string): string | null;
  toString(): string;
}

declare class URL {
  constructor(url: string, base?: string);
  readonly protocol: string;
  readonly host: string;
  readonly hostname: string;
  readonly port: string;
  readonly pathname: string;
  readonly search: string;
  readonly hash: string;
  readonly origin: string;
  readonly href: string;
  readonly searchParams: URLSearchParams;
  toString(): string;
}

declare function structuredClone<T>(value: T): T;

declare const console: {
  log(...args: unknown[]): void;
  error(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  info(...args: unknown[]): void;
};

declare function setTimeout(handler: () => void, timeout?: number): unknown;
declare function clearTimeout(handle: unknown): void;
declare function setInterval(handler: () => void, timeout?: number): unknown;
declare function clearInterval(handle: unknown): void;

/** Yield a macrotask. Node-native; the WebView/RN harness must polyfill it
 *  (e.g. `(cb) => setTimeout(cb, 0)`) — the sandbox promise driver uses it to
 *  interleave guest jobs with the host event loop. */
declare function setImmediate(handler: () => void): void;
