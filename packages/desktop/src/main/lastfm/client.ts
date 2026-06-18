import { createHash } from "node:crypto";
import { LastfmClient as CoreLastfmClient } from "@musex/core";

const md5: (s: string) => string = (s) => createHash("md5").update(s, "utf8").digest("hex");

export { isLastfmError, LastfmError } from "@musex/core";

/** Desktop client: the core client with a node:crypto MD5 hasher injected, so
 *  callers keep the {apiKey, secret, fetchFn} constructor shape. */
export class LastfmClient extends CoreLastfmClient {
  constructor(deps: { apiKey: string; secret: string; fetchFn: typeof fetch }) {
    super({ ...deps, hasher: md5 });
  }
}
