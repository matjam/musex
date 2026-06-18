import * as sha256Ns from "js-sha256";

// js-sha256 is CommonJS. Across bundler interops the callable lands in different
// places: the namespace itself (CJS require returns the function directly), `.sha256`
// (js-sha256 attaches itself there), or `.default` (some esm-interop synthesizes it).
// Resolve robustly so the cache filename hash is stable under every runtime —
// a wrong shape silently breaks ALL cache keys (every read misses). Mirrors the
// js-md5 resolution in src/lastfm/md5.ts.
const ns = sha256Ns as unknown as
  | ((input: string) => string)
  | { default?: (input: string) => string; sha256?: (input: string) => string };
const _sha256: (input: string) => string =
  typeof ns === "function" ? ns : (ns.sha256 ?? ns.default ?? (() => ""));

/** Pure-JS SHA-256 hex digest — the cache-key → filename hasher for MobileListCache. */
export const sha256hex = (input: string): string => _sha256(input);
