/** The minimal host globals core relies on — declared by hand instead of
 *  pulling in the full DOM lib, so the purity boundary stays
 *  compiler-enforced (a stray `fetch`/`document`/`window` in core fails
 *  typecheck) and this file doubles as the exact polyfill manifest for the
 *  future React Native adapter (Hermes lacks a full URL; structuredClone
 *  support varies by engine). Add members here only when core genuinely
 *  needs them on every target platform. */

declare class URLSearchParams {
  constructor(init?: string | Record<string, string> | [string, string][]);
  get(name: string): string | null;
  toString(): string;
}

declare class URL {
  constructor(url: string, base?: string);
  readonly protocol: string;
  readonly pathname: string;
  readonly searchParams: URLSearchParams;
  toString(): string;
}

declare function structuredClone<T>(value: T): T;
