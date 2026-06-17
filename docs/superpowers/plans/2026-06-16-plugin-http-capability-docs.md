# SP1 — Plugin API HTTP Capability + Docs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add a kernel HTTP capability (`ctx.net`) so plugins get TLS-controlled HTTP without importing `node:*`; refactor in-repo Lidarr to use it (making it pure `@musex/plugin-api`); write the full plugin API reference.

**Architecture:** New optional `ctx.net.client(opts)` on `PluginContext` (back-compatible, `apiVersion` stays 1). The host (desktop main) owns the `node:http`/`node:https` TLS code in a small, tested `net-client.ts`. Lidarr's `transport.ts` drops its Node imports and just adapts a fetch into its `HttpFn`.

**Tech Stack:** `@musex/plugin-api` (types-only), Electron main (Node 24), vitest.

**Roadmap:** `docs/superpowers/specs/2026-06-16-plugin-distribution-roadmap.md` (this is piece 1 of 4).
**Branch:** `feature/plugin-http-capability-and-docs`.

## Reference (verified current code)

- `PluginContext` (`packages/plugin-api/src/index.ts`) has `fetch: typeof fetch` (= `globalThis.fetch`), `storage`, `secrets`, `log`, `events`, `library`, `ui`, `registerTrackRecommender`, `registerAcquisitionProvider`, `registerSettings`, `onSettingsAction`. `PluginManifest.apiVersion` must equal `HOST_API_VERSION = 1`.
- `buildPluginContext` (`packages/desktop/src/main/plugins/plugin-context.ts`) assigns `fetch: globalThis.fetch` directly.
- Lidarr `client.ts`: `HttpFn = (url, init: {method, headers, body?}) => Promise<{ok, status, text()}>`; `LidarrClient` ctor takes `{baseUrl, apiKey, httpFn}`.
- Lidarr `transport.ts`: `fetchTransport` (wraps global fetch → HttpResponse) + `createNodeTransport({allowSelfSigned})` (uses `node:http`/`node:https`, `rejectUnauthorized:false`).
- Lidarr `index.ts` client factory reads `allowSelfSigned` from storage and swaps `createNodeTransport` vs `fetchTransport`; settings declare `allowSelfSigned` (toggle).
- Lidarr is the ONLY repo plugin using `node:*` for HTTP. lastfm uses `node:crypto` (pure signing — leave it).

---

## Task 1: plugin-api — add the `net` capability

**Files:** Modify `packages/plugin-api/src/index.ts`

- [ ] **Step 1: Add the `NetClientOptions` type + `net` field**

Add the type (near the other kernel types) and add an optional `net` to `PluginContext`:

```typescript
/** Options for the kernel HTTP client (`ctx.net.client`). */
export interface NetClientOptions {
  /** Skip TLS certificate verification — for self-hosted servers behind a
   *  self-signed cert. Default false. Honored by the host's HTTP transport. */
  allowSelfSigned?: boolean;
}
```

In `PluginContext`, add after `fetch: typeof fetch;`:

```typescript
  /** HTTP with platform-honored transport options (e.g. relaxed TLS for a
   *  self-hosted server with a self-signed cert) WITHOUT importing `node:*`.
   *  `client(opts)` returns a `fetch`-shaped function; `ctx.fetch` covers the
   *  common case. Optional — a host may not provide it; plugins should fall
   *  back to `ctx.fetch` (`ctx.net?.client(opts) ?? ctx.fetch`). */
  net?: {
    client(opts?: NetClientOptions): typeof fetch;
  };
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @musex/plugin-api exec tsc --noEmit` (or `pnpm --filter @musex/plugin-api typecheck`)
Expected: clean. (`@musex/plugin-api` is types-only; no tests.)

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(plugin-api): add optional ctx.net HTTP capability (TLS options)"
```

---

## Task 2: desktop — host `net-client` + wire into the context

**Files:**
- Create: `packages/desktop/src/main/plugins/net-client.ts`
- Test: `packages/desktop/src/main/plugins/net-client.test.ts`
- Modify: `packages/desktop/src/main/plugins/plugin-context.ts`

- [ ] **Step 1: Write the failing test**

`packages/desktop/src/main/plugins/net-client.test.ts`:

```typescript
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createNetClient } from "./net-client";

let server: http.Server;
let base: string;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => {
      body += c;
    });
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ method: req.method, path: req.url, body }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
});

describe("createNetClient", () => {
  it("returns global fetch by default and when allowSelfSigned is false", () => {
    expect(createNetClient()).toBe(globalThis.fetch);
    expect(createNetClient({ allowSelfSigned: false })).toBe(globalThis.fetch);
  });

  it("allowSelfSigned client performs a GET and returns a Response", async () => {
    const f = createNetClient({ allowSelfSigned: true });
    const res = await f(`${base}/x`, { method: "GET" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ method: "GET", path: "/x" });
  });

  it("allowSelfSigned client sends a POST body and headers", async () => {
    const f = createNetClient({ allowSelfSigned: true });
    const res = await f(`${base}/y`, {
      method: "POST",
      headers: { "x-api-key": "K" },
      body: "hello",
    });
    expect(await res.json()).toMatchObject({ method: "POST", body: "hello" });
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `pnpm --filter @musex/desktop test net-client`
Expected: FAIL (`Cannot find module './net-client'`).

- [ ] **Step 3: Implement `net-client.ts`**

`packages/desktop/src/main/plugins/net-client.ts`:

```typescript
import http from "node:http";
import https from "node:https";
import type { NetClientOptions } from "@musex/plugin-api";

/** A `fetch`-shaped HTTP client the host hands to plugins via `ctx.net.client`.
 *  Default (verify TLS) is just global fetch. When `allowSelfSigned` is set,
 *  requests go through node:http(s) with `rejectUnauthorized:false` and a
 *  buffered Response is returned (sufficient for JSON APIs) — so plugins never
 *  import `node:*`. */
export function createNetClient(opts?: NetClientOptions): typeof fetch {
  if (!opts?.allowSelfSigned) return globalThis.fetch;
  return ((input: RequestInfo | URL, init?: RequestInit) =>
    nodeRequest(toUrl(input), init)) as typeof fetch;
}

function toUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function toHeaderObject(h: HeadersInit | undefined): Record<string, string> {
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
          resolve(new Response(Buffer.concat(chunks), { status: res.statusCode ?? 0, headers }));
        });
      },
    );
    req.on("error", reject);
    const body = init?.body;
    if (typeof body === "string") req.write(body);
    req.end();
  });
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `pnpm --filter @musex/desktop test net-client`
Expected: PASS (3 tests).

- [ ] **Step 5: Wire `net` into `buildPluginContext`**

In `packages/desktop/src/main/plugins/plugin-context.ts`, add the import:

```typescript
import { createNetClient } from "./net-client";
```

and add the `net` field to the returned context object, right after `fetch: globalThis.fetch,`:

```typescript
    fetch: globalThis.fetch,
    net: { client: (opts) => createNetClient(opts) },
```

- [ ] **Step 6: Typecheck + commit**

Run: `pnpm --filter @musex/desktop exec biome check --write src/main/plugins/net-client.ts src/main/plugins/net-client.test.ts src/main/plugins/plugin-context.ts && pnpm --filter @musex/desktop exec tsc --noEmit -p tsconfig.node.json`
Expected: clean.

```bash
git add -A
git commit -m "feat(desktop): host net-client (node TLS) wired into ctx.net"
```

---

## Task 3: lidarr — use `ctx.net`, drop `node:http`/`node:https`

**Files:**
- Modify: `plugins/lidarr/src/transport.ts`
- Modify: `plugins/lidarr/src/index.ts`
- Modify/Delete: `plugins/lidarr/src/transport.test.ts` (if it exists — check first)

- [ ] **Step 1: Replace `transport.ts` with a Node-free fetch→HttpFn adapter**

Replace the ENTIRE `plugins/lidarr/src/transport.ts` with:

```typescript
/**
 * Adapts a fetch-shaped function (ctx.fetch or ctx.net.client(...)) into the
 * LidarrClient's minimal HttpFn. TLS control (self-signed certs) now lives in
 * the host's ctx.net capability, so this plugin no longer imports node:*.
 */
import type { HttpFn } from "./client.js";

export function httpFnFrom(f: typeof fetch): HttpFn {
  return async (url, init) => {
    const res = await f(url, init);
    return { ok: res.ok, status: res.status, text: () => res.text() };
  };
}
```

- [ ] **Step 2: Update the client factory in `index.ts`**

Change the import line from:

```typescript
import { createNodeTransport, fetchTransport } from "./transport.js";
```

to:

```typescript
import { httpFnFrom } from "./transport.js";
```

Replace the client-factory body that swaps transports with the `ctx.net` form:

```typescript
  const client = async (): Promise<LidarrClient | null> => {
    const cfg = await configured();
    if (!cfg) return null;
    // TLS control (self-signed certs) is provided by the host via ctx.net;
    // fall back to ctx.fetch when the host doesn't expose it.
    const allowSelfSigned = (await ctx.storage.get<boolean>("allowSelfSigned")) === true;
    const netFetch = ctx.net?.client({ allowSelfSigned }) ?? ctx.fetch;
    return new LidarrClient({ baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, httpFn: httpFnFrom(netFetch) });
  };
```

(The `registerSettings([...])` block with the `allowSelfSigned` toggle stays unchanged.)

- [ ] **Step 3: Handle the transport test**

Check for `plugins/lidarr/src/transport.test.ts`. If it exists and tests `createNodeTransport`/`fetchTransport`, replace it with a test of `httpFnFrom`:

```typescript
import { describe, expect, it } from "vitest";
import { httpFnFrom } from "./transport";

describe("httpFnFrom", () => {
  it("maps a fetch Response to HttpResponse (ok/status/text)", async () => {
    const fake: typeof fetch = (async () =>
      new Response("body-text", { status: 201 })) as typeof fetch;
    const httpFn = httpFnFrom(fake);
    const res = await httpFn("http://x/y", { method: "GET", headers: {} });
    expect(res.ok).toBe(true);
    expect(res.status).toBe(201);
    expect(await res.text()).toBe("body-text");
  });
});
```

- [ ] **Step 4: Verify lidarr is Node-free + tests pass**

Run: `grep -rn "node:" plugins/lidarr/src` → Expected: NO matches (lidarr now imports zero `node:*`).
Run: `pnpm --filter @musex/plugin-lidarr test` → all pass.
Run: `pnpm --filter @musex/plugin-lidarr typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(lidarr): use ctx.net for TLS, drop node:http/https"
```

---

## Task 4: docs — full plugin API reference

**Files:** Modify `docs/plugins.md`

- [ ] **Step 1: Expand `docs/plugins.md` into a complete reference**

Bring `docs/plugins.md` up to a full, accurate reference of the `@musex/plugin-api` surface. It must document everything below (using the real signatures from `packages/plugin-api/src/index.ts` as the source of truth) and close the known gaps:

- **Manifest** (`plugin.json`): `id` (`^[a-z0-9-]+$`), `name`, `version`, `apiVersion` (must equal host `1`), `entry` (plain filename), `description?`. Note apiVersion-mismatch → listed "incompatible", never activated.
- **Entry contract:** ESM `export function activate(ctx: PluginContext)` (required) + optional `deactivate()`. Disposables auto-disposed on reload/disable.
- **Kernel:** `log`, `storage.get/set`, `secrets.get/set` (null deletes; safeStorage-encrypted), `fetch`, and the **new `net.client(opts)`** (document `allowSelfSigned`, the fetch-shaped return, and the `ctx.net?.client(opts) ?? ctx.fetch` fallback pattern).
- **Events:** `events.on(event, handler)` — full table incl. the previously-undocumented **`trackRated`** (`{track, rating10}`), plus trackStarted/trackEnded/paused/resumed/scrobble with payloads. Note **handler errors are isolated/logged**, never propagate.
- **Library (read-only):** `search`, `recentlyPlayed`, and the previously-undocumented **`topArtists(limit?)`** (decayed-affinity score).
- **UI contribution points:** `contributeSections` (target "discover"|"home"; **matching is case-insensitive against the library; owned→navigable, unowned→external badge opening `externalUrl`**; **handlers run with an ~8s timeout + isolation** — throw/timeout is skipped, never breaks playback or other plugins), `contributeTrackAction` (**icon allowlist:** `heart`/`star`/`external-link`, else generic), `contributeTrackDetail` (**null return = no detail rendered**), `registerSimilarProvider` (similarArtists/similarTracks/topAlbums/artistInfo; `SimilarItem.match` 0..1).
- **Radio:** `registerTrackRecommender`.
- **Acquisition (source plugins):** `registerAcquisitionProvider` — document the FULL `AcquisitionProvider` interface with **method signatures** (required `lookupArtistAlbums`/`acquireAlbum`/`status`; optional `searchArtists`/`acquireArtist`/`cancelAlbum`/`watchNewReleases`/`isWatchingNewReleases`/`listWatchedArtists`/`listMonitoredArtists`). Document the **`providerRef` contract** (opaque to host; the plugin `JSON.stringify`s on create and `JSON.parse`s on receipt), the **new-release watch semantics** (enabling must not separately monitor existing albums), and that the host **caches `listMonitoredArtists` ~60s, invalidated after `acquireArtist`**.
- **Settings:** the `SettingField` kinds (text/password/toggle/action/status) — note **password → secrets**, **action button blocks until the handler returns `{ok,message?}`**, **status renders a value the plugin sets**, and that new field kinds require a host change (plugins ship no UI).
- **Image URLs:** must be http(s) (no file:/data:); host proxies/caches them; relative URLs unsupported.
- **Building a user plugin:** the esbuild recipe → `index.mjs` + `plugin.json`; install = drop into `userData/plugins/<id>/` then Reload (note: GitHub install is coming in a later piece).
- **Trust model:** full-trust, main-process; only install plugins you trust.

- [ ] **Step 2: Verify the doc compiles in the repo's prose checks (if any) and commit**

Run: `pnpm --filter @musex/desktop exec biome check docs/plugins.md 2>/dev/null || true` (docs may be biome-excluded; don't fail on it)

```bash
git add -A
git commit -m "docs: complete the plugin API reference (close gaps + ctx.net)"
```

---

## Task 5: Full check, CLAUDE.md, push, PR

- [ ] **Step 1: Full CI-equivalent check**

Run: `pnpm check`
Expected: green (typecheck + biome + tests across all packages). Fix any repo-wide biome with `pnpm exec biome check --write .` and re-run.

- [ ] **Step 2: Confirm the API goal is met**

Run: `grep -rn "node:" plugins/lidarr/src` → no matches. Lidarr now depends only on `@musex/plugin-api`.

- [ ] **Step 3: Update `CLAUDE.md`** — note: `ctx.net.client(opts)` HTTP capability added (host owns node TLS in `main/plugins/net-client.ts`); lidarr is now Node-free / pure `@musex/plugin-api`; `docs/plugins.md` is the full API reference; `apiVersion` still 1 (`net` optional). Reference the roadmap doc as the umbrella for the 4-piece plugin-distribution arc.

```bash
git add -A
git commit -m "docs: record ctx.net capability + plugin-distribution roadmap in CLAUDE.md"
```

- [ ] **Step 4: Push + open PR**

```bash
git push -u origin feature/plugin-http-capability-and-docs
gh pr create --draft --title "feat: plugin API HTTP capability (ctx.net) + full API docs" --body "<summary + roadmap link + that lidarr is now node-free; piece 1/4 of plugin distribution>"
```

Body must: link the roadmap, state this is piece 1/4, summarize `ctx.net` + the lidarr refactor + the docs, and note no user-facing behavior change.

---

## Self-review (controller)
- **Spec/roadmap coverage:** SP1 goals = `ctx.net` (T1+T2), lidarr node-free (T3), full docs (T4). ✓
- **Type consistency:** `NetClientOptions` (T1) used by `createNetClient` (T2) and lidarr (T3 via `ctx.net?.client`). `httpFnFrom` returns the existing `HttpFn` (T3). ✓
- **No placeholders:** full code in every code step; docs task enumerates exact content. ✓
- **Risk:** `net-client.ts` uses `node:http(s)` in the host — fine (desktop main). The self-signed HTTPS path is manually verified against a real Lidarr; the http path + global-fetch passthrough are unit-tested. The lidarr `transport.test.ts` may not exist — Step 3 says check first.
