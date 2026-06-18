import { createHash } from "node:crypto";
import { sign as coreSign } from "@musex/core";

const md5: (s: string) => string = (s) => createHash("md5").update(s, "utf8").digest("hex");

/** Desktop signature: delegates to the core signer with a node:crypto MD5. */
export function sign(params: Record<string, string>, secret: string): string {
  return coreSign(params, secret, md5);
}
