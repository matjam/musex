import { sign } from "./signing.js";

const API_URL = "https://ws.audioscrobbler.com/2.0/";

/** A last.fm API-level error (`{ error, message }` body, HTTP 200 or 4xx). */
export class LastfmError extends Error {
  constructor(
    readonly code: number,
    detail: string,
  ) {
    super(`last.fm ${code}: ${detail}`);
    this.name = "LastfmError";
  }
}

export function isLastfmError(e: unknown, code: number): boolean {
  return e instanceof LastfmError && e.code === code;
}

/**
 * Minimal last.fm REST client. Every call is signed (`api_sig`), POSTed
 * form-encoded with `format=json` appended AFTER signing (the signature
 * excludes `format`). No retries anywhere — by design (scrobble guidance).
 */
export class LastfmClient {
  constructor(private readonly deps: { apiKey: string; secret: string; fetchFn: typeof fetch }) {}

  async call<T>(
    method: string,
    params: Record<string, string>,
    opts?: { sk?: string },
  ): Promise<T> {
    const signedParams: Record<string, string> = {
      method,
      api_key: this.deps.apiKey,
      ...params,
      ...(opts?.sk !== undefined ? { sk: opts.sk } : {}),
    };
    const apiSig = sign(signedParams, this.deps.secret);
    const body = new URLSearchParams({ ...signedParams, api_sig: apiSig, format: "json" });
    const res = await this.deps.fetchFn(API_URL, { method: "POST", body });
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      // Non-JSON body — surface the transport-level failure instead.
      throw new Error(`last.fm HTTP ${res.status}: invalid response`);
    }
    const maybeError = json as { error?: unknown; message?: unknown };
    if (typeof maybeError.error === "number") {
      throw new LastfmError(
        maybeError.error,
        typeof maybeError.message === "string" ? maybeError.message : "unknown error",
      );
    }
    if (!res.ok) throw new Error(`last.fm HTTP ${res.status}`);
    return json as T;
  }
}
