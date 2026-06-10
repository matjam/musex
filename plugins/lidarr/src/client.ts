/**
 * Minimal Lidarr v1 API client. Every request carries the `X-Api-Key` header;
 * callers pass full API paths (e.g. "/api/v1/album"). Non-2xx responses throw
 * a LidarrError carrying the HTTP status and the response body text. No
 * retries — callers own any retry policy.
 *
 * Endpoints verified against the Lidarr OpenAPI spec
 * (Lidarr/Lidarr src/Lidarr.Api.V1/openapi.json, 2026-06-09).
 */

/** Minimal response shape the client needs from a transport. */
export interface HttpResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

/** Minimal fetch-like transport (implementations live in transport.ts). The
 *  client depends on this instead of global fetch so TLS behavior can be
 *  swapped (node:https with rejectUnauthorized:false for self-signed certs). */
export type HttpFn = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<HttpResponse>;

/** A non-2xx response from Lidarr (HTTP status + body text). */
export class LidarrError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`Lidarr HTTP ${status}${body ? `: ${body}` : ""}`);
    this.name = "LidarrError";
  }
}

export class LidarrClient {
  /** baseUrl normalized: trailing slashes stripped. */
  private readonly baseUrl: string;

  constructor(
    private readonly deps: {
      baseUrl: string;
      apiKey: string;
      httpFn: HttpFn;
    },
  ) {
    this.baseUrl = deps.baseUrl.replace(/\/+$/, "");
  }

  url(path: string, params?: Record<string, string>): string {
    const query = params ? `?${new URLSearchParams(params)}` : "";
    return `${this.baseUrl}${path}${query}`;
  }

  async get<T>(path: string, params?: Record<string, string>): Promise<T> {
    return this.request<T>("GET", this.url(path, params));
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>("POST", this.url(path), body);
  }

  async put<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>("PUT", this.url(path), body);
  }

  private async request<T>(method: string, url: string, body?: unknown): Promise<T> {
    const res = await this.deps.httpFn(url, {
      method,
      headers: {
        "X-Api-Key": this.deps.apiKey,
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    if (!res.ok) throw new LidarrError(res.status, text);
    // Some endpoints (202 Accepted) may return an empty body.
    if (text.length === 0) return undefined as T;
    return JSON.parse(text) as T;
  }
}
