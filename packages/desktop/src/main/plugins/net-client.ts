import http from "node:http";
import https from "node:https";

/** Internal options for the host HTTP transport; mirrors the NetFetchInit
 *  subset relevant to the transport layer. */
export interface NetClientOptions {
  /** Skip TLS certificate verification — for self-hosted servers behind a
   *  self-signed cert. Default false. */
  allowSelfSigned?: boolean;
}

/** A `fetch`-shaped HTTP client used by the host's `ctx.net.fetch` impl.
 *  Default (verify TLS) is just global fetch. When `allowSelfSigned` is set,
 *  requests go through node:http(s) with `rejectUnauthorized:false` and a
 *  buffered Response is returned (sufficient for JSON APIs). */
export function createNetClient(opts?: NetClientOptions): typeof fetch {
  if (!opts?.allowSelfSigned) return globalThis.fetch;
  return ((input: Parameters<typeof fetch>[0], init?: RequestInit) =>
    nodeRequest(toUrl(input), init)) as typeof fetch;
}

function toUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return (input as Request).url;
}

function toHeaderObject(h: RequestInit["headers"] | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!h) return out;
  if (h instanceof Headers) {
    h.forEach((v, k) => {
      out[k] = v;
    });
  } else if (Array.isArray(h)) {
    for (const [k, v] of h) out[k] = v;
  } else {
    Object.assign(out, h);
  }
  return out;
}

function nodeRequest(url: string, init?: RequestInit): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    const isHttps = new URL(url).protocol === "https:";
    const mod = isHttps ? https : http;
    const req = mod.request(
      url,
      {
        method: init?.method ?? "GET",
        headers: toHeaderObject(init?.headers),
        ...(isHttps ? { rejectUnauthorized: false } : {}),
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("error", reject);
        res.on("end", () => {
          const headers: Record<string, string> = {};
          for (const [k, v] of Object.entries(res.headers)) {
            if (typeof v === "string") headers[k] = v;
            else if (Array.isArray(v)) headers[k] = v.join(", ");
          }
          resolve(
            new Response(Buffer.concat(chunks), {
              status: res.statusCode ?? 0,
              headers,
            }),
          );
        });
      },
    );
    req.on("error", reject);
    const body = init?.body;
    if (typeof body === "string") req.write(body);
    req.end();
  });
}
