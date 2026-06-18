import type { Hasher } from "@musex/core";
import * as md5Impl from "js-md5";

// js-md5 uses `export =` (CommonJS). Under ESM interop the callable is at
// `.default`; TypeScript's type for `export =` doesn't model this, so we cast.
const _md5 = (md5Impl as unknown as { default: (input: string) => string }).default;

/** Pure-JS MD5 hex hasher for the core last.fm protocol's Hasher port. */
export const md5Hasher: Hasher = (input) => _md5(input);
