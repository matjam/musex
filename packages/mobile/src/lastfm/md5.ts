import type { Hasher } from "@musex/core";
import * as md5Ns from "js-md5";

// js-md5 is CommonJS (`export = md5`). Across bundler interops the callable
// lands in different places: the namespace itself (Hermes/Metro can return the
// function directly), `.default` (vitest/esbuild synthesizes it), or `.md5`
// (js-md5 attaches itself there). Resolve robustly so signing works under every
// runtime — a wrong shape here silently breaks ALL last.fm signatures.
const ns = md5Ns as unknown as
  | ((input: string) => string)
  | { default?: (input: string) => string; md5?: (input: string) => string };
const _md5: (input: string) => string =
  typeof ns === "function" ? ns : (ns.default ?? ns.md5 ?? (() => ""));

/** Pure-JS MD5 hex hasher for the core last.fm protocol's Hasher port. */
export const md5Hasher: Hasher = (input) => _md5(input);
