import { createHash } from "node:crypto";

/**
 * last.fm API signature: md5 hex of every param's `name + value`, concatenated
 * in alphabetical order of the param NAME, with the shared secret appended.
 *
 * `format` must NOT be among the params — the signature excludes it (callers
 * sign first, then append `format=json` to the request body).
 */
export function sign(params: Record<string, string>, secret: string): string {
  const concat = Object.entries(params)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, value]) => name + value)
    .join("");
  return createHash("md5")
    .update(concat + secret, "utf8")
    .digest("hex");
}
