import type { Hasher } from "../ports/hasher.js";

const API_URL = "https://ws.audioscrobbler.com/2.0/";

/** Minimal response interface — avoids importing DOM or node types into core. */
export interface LastfmResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

/** Minimal fetch interface for the last.fm client — host supplies the real fetch. */
export type LastfmFetch = (
  url: string,
  init: { method: string; body: URLSearchParams },
) => Promise<LastfmResponse>;

/** last.fm API signature: md5 hex of every param's `name + value`, concatenated
 *  in alphabetical order of the param NAME, with the shared secret appended.
 *  `format` must NOT be among the params (callers sign first, append format after). */
export function sign(params: Record<string, string>, secret: string, hasher: Hasher): string {
  const concat = Object.entries(params)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, value]) => name + value)
    .join("");
  return hasher(concat + secret);
}

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

/** Minimal last.fm REST client. Signed (`api_sig`) by default, POSTed
 *  form-encoded with `format=json` appended AFTER signing. Read methods pass
 *  `{ signed: false }`. No retries by design (scrobble guidance). */
export class LastfmClient {
  constructor(
    private readonly deps: { apiKey: string; secret: string; fetchFn: LastfmFetch; hasher: Hasher },
  ) {}

  async call<T>(
    method: string,
    params: Record<string, string>,
    opts?: { sk?: string; signed?: boolean },
  ): Promise<T> {
    const baseParams: Record<string, string> = {
      method,
      api_key: this.deps.apiKey,
      ...params,
      ...(opts?.sk !== undefined ? { sk: opts.sk } : {}),
    };
    const body = new URLSearchParams(
      opts?.signed === false
        ? { ...baseParams, format: "json" }
        : {
            ...baseParams,
            api_sig: sign(baseParams, this.deps.secret, this.deps.hasher),
            format: "json",
          },
    );
    const res = await this.deps.fetchFn(API_URL, { method: "POST", body });
    let json: unknown;
    try {
      json = await res.json();
    } catch {
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
