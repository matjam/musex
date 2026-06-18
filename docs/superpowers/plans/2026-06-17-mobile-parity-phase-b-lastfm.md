# Mobile Feature Parity — Phase B: last.fm Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring last.fm to mobile as a first-party core service — scrobbling, love-on-rating, similar artists, artist bio, and Radio mode — by promoting the desktop last.fm protocol to `@musex/core` (with a `Hasher` port) and building a mobile `LastfmService` + UI.

**Architecture:** Promote pure `sign` + `LastfmClient` to core with a `Hasher` port (host supplies MD5; core stays zero-dep). Desktop re-points its `signing.ts`/`client.ts` to the core version via a `node:crypto` hasher (service.ts unchanged). Mobile builds a `LastfmService` adapter (pure-JS `js-md5` Hasher, fetch, secure-store secrets, async-storage config) wired into the store, plus a settings/connect pane, scrobble/love hooks off the existing `PlayMonitor`, a Similar+bio artist page, and Radio mode (pure coordination in core `radio.ts`).

**Tech Stack:** TypeScript 6 (`verbatimModuleSyntax`), Expo SDK 56 / RN 0.85 / expo-router, vitest 4 (fake fetch + injected Hasher), biome 2, lucide-react-native. New deps: `expo-web-browser` (auth, native → dev-client rebuild), `js-md5` (pure JS, no native).

**Spec:** `docs/superpowers/specs/2026-06-17-mobile-parity-phase-b-lastfm-design.md`

---

## Conventions for every task

- **Verification bar:** after a task's edits, run `pnpm check` from `/Users/matjam/src/musex` (`pnpm -r typecheck && biome check . && pnpm -r test`) → exit 0 before commit. biome diffs → `pnpm exec biome check --write .` then re-run.
- Core (`packages/core/src`) NEVER imports its own barrel `@musex/core` — relative `.js` paths. App + test files may import `@musex/core`.
- `import type` for type-only; merge `@musex/core` import lines; lucide icons only (no emoji). `git add -A`; one commit per task with the exact message given.
- UI tasks (settings screen, artist rail, radio pill) have no unit tests — gate is `pnpm check`; on-device acceptance is the user's. Core + service tasks are TDD.
- Branch `feature/mobile-parity-phase-b-lastfm` already has the spec committed. Do NOT push (controller pushes after review).

---

## File Structure

**Core (new):** `ports/hasher.ts` (`Hasher` type), `logic/lastfm-protocol.ts` (+ test), `logic/radio.ts` (+ test); barrel updates.
**Desktop (modified):** `main/lastfm/signing.ts` + `main/lastfm/client.ts` become thin adapters over core (inject `node:crypto` MD5).
**Mobile (new):** `src/lastfm/md5.ts` (+ test), `src/lastfm/lastfm-service.ts` (+ test), `src/adapters/lastfm-store.ts` (secrets + config persistence), `app/(tabs)/settings/lastfm.tsx`.
**Mobile (modified):** `src/state/store.tsx` (construct/expose `lastfm`, scrobble/love/now-playing/radio hooks), `app/(tabs)/settings/{_layout,index}.tsx`, `app/(tabs)/library/albums.tsx` (similar rail + bio), `src/ui/TrackActionSheet.tsx` ("Start radio"), `app/now-playing.tsx` (Radio pill), `package.json` (deps).

---

### Task 1: Core `Hasher` port + `lastfm-protocol.ts`

**Files:** Create `packages/core/src/ports/hasher.ts`, `packages/core/src/logic/lastfm-protocol.ts`, `packages/core/src/logic/lastfm-protocol.test.ts`. Modify `packages/core/src/index.ts`.

- [ ] **Step 1: Write the failing test** (`packages/core/src/logic/lastfm-protocol.test.ts`) — reuses the desktop signing vector:

```ts
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { LastfmClient, LastfmError, isLastfmError, sign } from "./lastfm-protocol.js";

const md5 = (s: string): string => createHash("md5").update(s, "utf8").digest("hex");

describe("sign", () => {
  it("matches the hand-computed vector (sorted name+value concat + secret)", () => {
    expect(sign({ api_key: "abc", method: "auth.getToken" }, "sec", md5)).toBe(
      "3334e36028583f782c8e6db457c76835",
    );
  });
  it("sorts by param NAME regardless of insertion order", () => {
    expect(sign({ method: "auth.getToken", api_key: "abc" }, "sec", md5)).toBe(
      sign({ api_key: "abc", method: "auth.getToken" }, "sec", md5),
    );
  });
});

describe("LastfmClient", () => {
  it("signs by default, appends format=json after signing, POSTs form-encoded", async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ ok: 1 }), { status: 200 }));
    const c = new LastfmClient({ apiKey: "K", secret: "S", fetchFn, hasher: md5 });
    await c.call("track.love", { artist: "A", track: "T" }, { sk: "SK" });
    const body = (fetchFn.mock.calls[0]?.[1] as { body: URLSearchParams }).body;
    const params = new URLSearchParams(body.toString());
    expect(params.get("method")).toBe("track.love");
    expect(params.get("sk")).toBe("SK");
    expect(params.get("format")).toBe("json");
    expect(params.get("api_sig")).toBe(
      md5(`api_keyKartistAmethodtrack.loveskSKtrackTS`),
    );
  });
  it("skips the signature when signed:false", async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ ok: 1 }), { status: 200 }));
    const c = new LastfmClient({ apiKey: "K", secret: "S", fetchFn, hasher: md5 });
    await c.call("artist.getInfo", { artist: "A" }, { signed: false });
    const params = new URLSearchParams(
      (fetchFn.mock.calls[0]?.[1] as { body: URLSearchParams }).body.toString(),
    );
    expect(params.get("api_sig")).toBeNull();
  });
  it("throws LastfmError on an { error } body", async () => {
    const fetchFn = vi.fn(
      async () => new Response(JSON.stringify({ error: 14, message: "bad token" }), { status: 200 }),
    );
    const c = new LastfmClient({ apiKey: "K", secret: "S", fetchFn, hasher: md5 });
    await expect(c.call("auth.getSession", { token: "x" })).rejects.toBeInstanceOf(LastfmError);
    try {
      await c.call("auth.getSession", { token: "x" });
    } catch (e) {
      expect(isLastfmError(e, 14)).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run → fail.** `pnpm --filter @musex/core exec vitest run src/logic/lastfm-protocol.test.ts` → FAIL (module missing).

- [ ] **Step 3: Create the `Hasher` port** (`packages/core/src/ports/hasher.ts`):

```ts
/** Synchronous MD5-hex hasher. The host supplies the implementation
 *  (node:crypto on desktop, a pure-JS md5 on React Native) so core stays
 *  dependency-free. Input is UTF-8; output is lowercase hex. */
export type Hasher = (input: string) => string;
```

- [ ] **Step 4: Create `lastfm-protocol.ts`** — desktop's `signing.ts`+`client.ts` merged, with the MD5 injected as a `Hasher` (the ONLY change from desktop):

```ts
import type { Hasher } from "../ports/hasher.js";

const API_URL = "https://ws.audioscrobbler.com/2.0/";

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
    private readonly deps: { apiKey: string; secret: string; fetchFn: typeof fetch; hasher: Hasher },
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
```

- [ ] **Step 5: Barrel** — in `packages/core/src/index.ts` add (alphabetical in `// Logic`): `export * from "./logic/lastfm-protocol";` and in the ports section: `export type { Hasher } from "./ports/hasher";`.

- [ ] **Step 6: Run → pass.** `pnpm --filter @musex/core exec vitest run src/logic/lastfm-protocol.test.ts` → PASS.

- [ ] **Step 7: Verify + commit.** `pnpm check` → exit 0.
```bash
git add -A
git commit -m "feat(core): promote last.fm protocol with a Hasher port"
```

---

### Task 2: Core `radio.ts` (pure coordination)

**Files:** Create `packages/core/src/logic/radio.ts`, `packages/core/src/logic/radio.test.ts`. Modify `packages/core/src/index.ts`.

Radio coordination is pure decision logic; library resolution + queue mutation are the caller's job. The module decides: should we top up now, and have we hit the stop condition?

- [ ] **Step 1: Write the failing test** (`radio.test.ts`):

```ts
import { describe, expect, it } from "vitest";
import { radioKey, shouldTopUp, type RadioState, advanceRadio } from "./radio.js";

describe("radio coordination", () => {
  it("radioKey normalizes artist+title case/space", () => {
    expect(radioKey("M83", "Midnight City")).toBe(radioKey(" m83 ", "midnight city"));
  });
  it("shouldTopUp when active and up-next below the threshold", () => {
    expect(shouldTopUp({ active: true, emptyRounds: 0 }, 4)).toBe(true);
    expect(shouldTopUp({ active: true, emptyRounds: 0 }, 5)).toBe(false);
    expect(shouldTopUp({ active: false, emptyRounds: 0 }, 0)).toBe(false);
  });
  it("advanceRadio increments emptyRounds on no additions and stops after 2", () => {
    const s0: RadioState = { active: true, emptyRounds: 0 };
    const s1 = advanceRadio(s0, 0); // added 0
    expect(s1.emptyRounds).toBe(1);
    const s2 = advanceRadio(s1, 0);
    expect(s2).toEqual({ active: false, emptyRounds: 2 });
  });
  it("advanceRadio resets emptyRounds when tracks were added", () => {
    expect(advanceRadio({ active: true, emptyRounds: 1 }, 3)).toEqual({ active: true, emptyRounds: 0 });
  });
});
```

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Implement** (`radio.ts`):

```ts
/** Up-next count at/below which radio tops up. */
export const RADIO_TOPUP_THRESHOLD = 5;
/** Consecutive empty top-ups before radio auto-stops. */
const RADIO_MAX_EMPTY_ROUNDS = 2;

export interface RadioState {
  active: boolean;
  /** Consecutive top-ups that found nothing playable. */
  emptyRounds: number;
}

/** Stable key for exclude-set membership (case/space-insensitive). */
export function radioKey(artist: string, title: string): string {
  return `${artist.trim().toLowerCase()}␟${title.trim().toLowerCase()}`;
}

/** Top up when active and fewer than the threshold remain up next. */
export function shouldTopUp(state: RadioState, upNextCount: number): boolean {
  return state.active && upNextCount < RADIO_TOPUP_THRESHOLD;
}

/** After a top-up that appended `added` tracks: reset on progress, else count
 *  the empty round and stop after the cap. */
export function advanceRadio(state: RadioState, added: number): RadioState {
  if (added > 0) return { active: true, emptyRounds: 0 };
  const emptyRounds = state.emptyRounds + 1;
  return { active: emptyRounds < RADIO_MAX_EMPTY_ROUNDS, emptyRounds };
}
```

- [ ] **Step 4: Run → pass.**

- [ ] **Step 5: Barrel** — `export * from "./logic/radio";` (alphabetical, after `play-monitor`).

- [ ] **Step 6: Verify + commit.** `pnpm check` → 0.
```bash
git add -A
git commit -m "feat(core): add pure radio coordination logic"
```

---

### Task 3: Desktop re-points to the core protocol

**Files:** Modify `packages/desktop/src/main/lastfm/signing.ts`, `packages/desktop/src/main/lastfm/client.ts`.

Keep `service.ts` + `service.test.ts` UNCHANGED — the wrappers preserve the existing 2-arg `sign(params, secret)` and `new LastfmClient({apiKey, secret, fetchFn})` signatures by injecting the `node:crypto` MD5 hasher.

- [ ] **Step 1: Rewrite `signing.ts` as a wrapper:**

```ts
import { createHash } from "node:crypto";
import { sign as coreSign } from "@musex/core";

const md5: (s: string) => string = (s) => createHash("md5").update(s, "utf8").digest("hex");

/** Desktop signature: delegates to the core signer with a node:crypto MD5. */
export function sign(params: Record<string, string>, secret: string): string {
  return coreSign(params, secret, md5);
}
```

- [ ] **Step 2: Rewrite `client.ts` as a wrapper:**

```ts
import { createHash } from "node:crypto";
import { LastfmClient as CoreLastfmClient } from "@musex/core";

const md5: (s: string) => string = (s) => createHash("md5").update(s, "utf8").digest("hex");

export { LastfmError, isLastfmError } from "@musex/core";

/** Desktop client: the core client with a node:crypto MD5 hasher injected, so
 *  callers keep the {apiKey, secret, fetchFn} constructor shape. */
export class LastfmClient extends CoreLastfmClient {
  constructor(deps: { apiKey: string; secret: string; fetchFn: typeof fetch }) {
    super({ ...deps, hasher: md5 });
  }
}
```

- [ ] **Step 3: Verify + commit.** `pnpm check` → 0 (desktop's existing `service.test.ts` signing vectors + service tests must still pass, now exercising the core signer). If `service.test.ts` imported `sign` and asserted the exact hash, it stays green (same algorithm).
```bash
git add -A
git commit -m "refactor(desktop): use the core last.fm protocol (node:crypto Hasher)"
```

---

### Task 4: Mobile MD5 Hasher (`js-md5`)

**Files:** Modify `packages/mobile/package.json` (add `js-md5`); Create `packages/mobile/src/lastfm/md5.ts`, `packages/mobile/src/lastfm/md5.test.ts`.

- [ ] **Step 1: Add the dependency.** Run from `/Users/matjam/src/musex`: `pnpm --filter @musex/mobile add js-md5` (pure-JS MD5, no native module, sync). If types aren't bundled, also `pnpm --filter @musex/mobile add -D @types/js-md5`. (Check `npm view js-md5 version` to confirm latest stable; pin what `pnpm add` resolves.)

- [ ] **Step 2: Write the failing test** (`md5.test.ts`) — same vector as core:

```ts
import { describe, expect, it } from "vitest";
import { md5Hasher } from "./md5";

describe("md5Hasher", () => {
  it("produces the last.fm signing vector", () => {
    expect(md5Hasher("api_keyabcmethodauth.getTokensec")).toBe(
      "3334e36028583f782c8e6db457c76835",
    );
  });
  it("hashes UTF-8 correctly", () => {
    expect(md5Hasher("")).toBe("d41d8cd98f00b204e9800998ecf8427e");
  });
});
```

- [ ] **Step 3: Implement** (`md5.ts`) — a `Hasher` over `js-md5`:

```ts
import md5 from "js-md5";
import type { Hasher } from "@musex/core";

/** Pure-JS MD5 hex hasher for the core last.fm protocol's Hasher port. */
export const md5Hasher: Hasher = (input) => md5(input);
```

- [ ] **Step 4: Run → pass.** `pnpm --filter @musex/mobile exec vitest run src/lastfm/md5.test.ts`.

- [ ] **Step 5: Verify + commit.** `pnpm check` → 0.
```bash
git add -A
git commit -m "feat(mobile): add js-md5 Hasher for the last.fm protocol"
```

---

### Task 5: Mobile config/secret persistence (`lastfm-store.ts`)

**Files:** Create `packages/mobile/src/adapters/lastfm-store.ts`, `packages/mobile/src/adapters/lastfm-store.test.ts`.

Config (`apiKey`, `scrobbling`, `loveOnRating`, `username`, `connection`) in async-storage; `apiSecret` + `sessionKey` in secure-store. Mirror `taste-persistence.ts` (async-storage) + `token-store.ts` (secure-store).

- [ ] **Step 1: Define the config type + persistence.** Implement:

```ts
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";

export interface LastfmConfig {
  apiKey: string;
  scrobbling: boolean;
  loveOnRating: boolean;
  username: string | null;
  connection: string;
}

const CONFIG_KEY = "musex.lastfm";
const SECRET_KEY = "lastfm-secret";
const SESSION_KEY = "lastfm-session";

export const DEFAULT_LASTFM_CONFIG: LastfmConfig = {
  apiKey: "",
  scrobbling: true,
  loveOnRating: true,
  username: null,
  connection: "Not connected",
};

export async function loadLastfmConfig(): Promise<LastfmConfig> {
  try {
    const raw = await AsyncStorage.getItem(CONFIG_KEY);
    return raw ? { ...DEFAULT_LASTFM_CONFIG, ...(JSON.parse(raw) as Partial<LastfmConfig>) } : DEFAULT_LASTFM_CONFIG;
  } catch {
    return DEFAULT_LASTFM_CONFIG;
  }
}

export async function saveLastfmConfig(cfg: LastfmConfig): Promise<void> {
  try {
    await AsyncStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
  } catch (err) {
    console.warn("[lastfm] config save failed", err);
  }
}

export async function loadSecret(): Promise<string | null> {
  return SecureStore.getItemAsync(SECRET_KEY);
}
export async function saveSecret(secret: string): Promise<void> {
  await SecureStore.setItemAsync(SECRET_KEY, secret);
}
export async function loadSessionKey(): Promise<string | null> {
  return SecureStore.getItemAsync(SESSION_KEY);
}
export async function saveSessionKey(sk: string): Promise<void> {
  await SecureStore.setItemAsync(SESSION_KEY, sk);
}
export async function clearSession(): Promise<void> {
  await SecureStore.deleteItemAsync(SESSION_KEY);
}
```

- [ ] **Step 2: Test** (`lastfm-store.test.ts`) — mock both modules (Maps inside the factory, per the vitest hoisting rule); assert round-trip + the default-merge. Mock shape:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@react-native-async-storage/async-storage", () => {
  const m = new Map<string, string>();
  return { default: { getItem: async (k: string) => m.get(k) ?? null, setItem: async (k: string, v: string) => void m.set(k, v) } };
});
vi.mock("expo-secure-store", () => {
  const m = new Map<string, string>();
  return {
    getItemAsync: async (k: string) => m.get(k) ?? null,
    setItemAsync: async (k: string, v: string) => void m.set(k, v),
    deleteItemAsync: async (k: string) => void m.delete(k),
  };
});

import { DEFAULT_LASTFM_CONFIG, loadLastfmConfig, saveLastfmConfig, loadSecret, saveSecret } from "./lastfm-store";

describe("lastfm-store", () => {
  it("round-trips config with default merge", async () => {
    await saveLastfmConfig({ ...DEFAULT_LASTFM_CONFIG, apiKey: "K", scrobbling: false });
    const cfg = await loadLastfmConfig();
    expect(cfg.apiKey).toBe("K");
    expect(cfg.scrobbling).toBe(false);
    expect(cfg.loveOnRating).toBe(true); // default preserved
  });
  it("round-trips the secret via secure-store", async () => {
    await saveSecret("sssh");
    expect(await loadSecret()).toBe("sssh");
  });
});
```

- [ ] **Step 3: Run → pass; verify + commit.** `pnpm check` → 0.
```bash
git add -A
git commit -m "feat(mobile): persist last.fm config + secrets"
```

---

### Task 6: Mobile `LastfmService`

**Files:** Create `packages/mobile/src/lastfm/lastfm-service.ts`, `packages/mobile/src/lastfm/lastfm-service.test.ts`.

The service holds in-memory config + builds a core `LastfmClient` with `md5Hasher`. Exposes connect/scrobble/love/similar/info/recommend. Auth token-flow uses an injected `openAuth(url): Promise<void>` so the service is testable without expo-web-browser (the store passes the real `expo-web-browser` opener).

- [ ] **Step 1: Write the failing test** (`lastfm-service.test.ts`) — fake fetch + the real `md5Hasher`; assert the request shapes:

```ts
import { describe, expect, it, vi } from "vitest";
import { LastfmService } from "./lastfm-service";

function svc(fetchFn: typeof fetch) {
  return new LastfmService({
    fetchFn,
    openAuth: async () => {},
    getConfig: async () => ({ apiKey: "K", scrobbling: true, loveOnRating: true, username: "u", connection: "" }),
    setConfig: async () => {},
    getSecret: async () => "S",
    setSecret: async () => {},
    getSessionKey: async () => "SK",
    setSessionKey: async () => {},
    clearSession: async () => {},
  });
}
const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });

describe("LastfmService", () => {
  it("scrobble posts track.scrobble with timestamp + sk", async () => {
    const fetchFn = vi.fn(async () => ok({ scrobbles: {} }));
    await svc(fetchFn as never).scrobble({ artistName: "M83", title: "Wait", albumTitle: "Junk", durationMs: 240000 }, 1000);
    const p = new URLSearchParams((fetchFn.mock.calls[0]?.[1] as { body: URLSearchParams }).body.toString());
    expect(p.get("method")).toBe("track.scrobble");
    expect(p.get("artist")).toBe("M83");
    expect(p.get("track")).toBe("Wait");
    expect(p.get("timestamp")).toBe("1"); // 1000ms → 1s epoch
    expect(p.get("sk")).toBe("SK");
    expect(p.get("api_sig")).toBeTruthy();
  });
  it("similarArtists parses names (unsigned)", async () => {
    const fetchFn = vi.fn(async () =>
      ok({ similarartists: { artist: [{ name: "Tycho" }, { name: "Washed Out" }] } }),
    );
    const names = await svc(fetchFn as never).similarArtists("M83");
    expect(names).toEqual(["Tycho", "Washed Out"]);
    const p = new URLSearchParams((fetchFn.mock.calls[0]?.[1] as { body: URLSearchParams }).body.toString());
    expect(p.get("api_sig")).toBeNull(); // read method, unsigned
  });
  it("artistInfo returns an HTML-stripped bio", async () => {
    const fetchFn = vi.fn(async () =>
      ok({ artist: { name: "M83", bio: { summary: 'French project <a href="x">Read more</a> formed in 2001.' } } }),
    );
    const info = await svc(fetchFn as never).artistInfo("M83");
    expect(info?.bio).toBe("French project  formed in 2001.");
  });
  it("love uses track.love when connected", async () => {
    const fetchFn = vi.fn(async () => ok({}));
    await svc(fetchFn as never).love({ artistName: "A", title: "T" });
    expect(new URLSearchParams((fetchFn.mock.calls[0]?.[1] as { body: URLSearchParams }).body.toString()).get("method")).toBe("track.love");
  });
});
```

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Implement** (`lastfm-service.ts`). Use the grounded call shapes (sign by default; reads `signed:false`; `sk` on writes). `connect()` = getToken → openAuth(authUrl) → getSession(token). Each method no-ops gracefully when not configured/connected.

```ts
import { LastfmClient, type LastfmError } from "@musex/core";
import { md5Hasher } from "./md5";
import type { LastfmConfig } from "../adapters/lastfm-store";

const AUTH_URL = "https://www.last.fm/api/auth/";

interface TrackLike {
  artistName: string;
  title: string;
  albumTitle?: string;
  durationMs?: number;
}

export interface LastfmServiceDeps {
  fetchFn: typeof fetch;
  /** Open the last.fm authorize URL and resolve when the user returns. */
  openAuth: (url: string) => Promise<void>;
  getConfig: () => Promise<LastfmConfig>;
  setConfig: (cfg: LastfmConfig) => Promise<void>;
  getSecret: () => Promise<string | null>;
  setSecret: (secret: string) => Promise<void>;
  getSessionKey: () => Promise<string | null>;
  setSessionKey: (sk: string) => Promise<void>;
  clearSession: () => Promise<void>;
}

export interface ArtistInfo {
  name: string;
  bio: string;
}

function stripHtml(s: string | undefined): string {
  return (s ?? "")
    .replace(/<a [^>]*>.*?<\/a>/gs, "")
    .replace(/<[^>]+>/g, "")
    .trim();
}

function trackParams(t: TrackLike): Record<string, string> {
  return {
    artist: t.artistName,
    track: t.title,
    ...(t.albumTitle ? { album: t.albumTitle } : {}),
    ...(t.durationMs && t.durationMs > 0 ? { duration: String(Math.round(t.durationMs / 1000)) } : {}),
  };
}

export class LastfmService {
  constructor(private readonly deps: LastfmServiceDeps) {}

  private async client(): Promise<LastfmClient | null> {
    const cfg = await this.deps.getConfig();
    const secret = await this.deps.getSecret();
    if (!cfg.apiKey || !secret) return null;
    return new LastfmClient({ apiKey: cfg.apiKey, secret, fetchFn: this.deps.fetchFn, hasher: md5Hasher });
  }

  private async connectedClient(): Promise<{ c: LastfmClient; sk: string } | null> {
    const c = await this.client();
    const sk = await this.deps.getSessionKey();
    return c && sk ? { c, sk } : null;
  }

  /** Token web-auth: getToken → open authorize URL → getSession. */
  async connect(): Promise<{ ok: boolean; message: string }> {
    const c = await this.client();
    if (!c) return { ok: false, message: "Enter your API key and secret first" };
    const cfg = await this.deps.getConfig();
    try {
      const { token } = await c.call<{ token: string }>("auth.getToken", {});
      await this.deps.openAuth(`${AUTH_URL}?api_key=${encodeURIComponent(cfg.apiKey)}&token=${token}`);
      const { session } = await c.call<{ session: { name: string; key: string } }>("auth.getSession", { token });
      await this.deps.setSessionKey(session.key);
      await this.deps.setConfig({ ...cfg, username: session.name, connection: `Connected as ${session.name}` });
      return { ok: true, message: `Connected as ${session.name}` };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, message: msg };
    }
  }

  async disconnect(): Promise<void> {
    await this.deps.clearSession();
    const cfg = await this.deps.getConfig();
    await this.deps.setConfig({ ...cfg, username: null, connection: "Not connected" });
  }

  async updateNowPlaying(track: TrackLike): Promise<void> {
    const cfg = await this.deps.getConfig();
    if (!cfg.scrobbling) return;
    const conn = await this.connectedClient();
    if (!conn) return;
    await conn.c.call("track.updateNowPlaying", trackParams(track), { sk: conn.sk }).catch(() => {});
  }

  async scrobble(track: TrackLike, startedAtMs: number): Promise<void> {
    const cfg = await this.deps.getConfig();
    if (!cfg.scrobbling) return;
    const conn = await this.connectedClient();
    if (!conn) return;
    await conn.c
      .call("track.scrobble", { ...trackParams(track), timestamp: String(Math.floor(startedAtMs / 1000)) }, { sk: conn.sk })
      .catch(() => {});
  }

  async love(track: TrackLike): Promise<void> {
    const conn = await this.connectedClient();
    if (!conn) return;
    await conn.c.call("track.love", { artist: track.artistName, track: track.title }, { sk: conn.sk }).catch(() => {});
  }

  async unlove(track: TrackLike): Promise<void> {
    const conn = await this.connectedClient();
    if (!conn) return;
    await conn.c.call("track.unlove", { artist: track.artistName, track: track.title }, { sk: conn.sk }).catch(() => {});
  }

  async similarArtists(artist: string, limit = 12): Promise<string[]> {
    const c = await this.client();
    if (!c) return [];
    try {
      const r = await c.call<{ similarartists?: { artist?: { name: string }[] } }>(
        "artist.getSimilar",
        { artist, limit: String(limit), autocorrect: "1" },
        { signed: false },
      );
      return (r.similarartists?.artist ?? []).map((a) => a.name);
    } catch {
      return [];
    }
  }

  async artistInfo(artist: string): Promise<ArtistInfo | null> {
    const c = await this.client();
    if (!c) return null;
    try {
      const r = await c.call<{ artist?: { name: string; bio?: { summary?: string } } }>(
        "artist.getInfo",
        { artist, autocorrect: "1" },
        { signed: false },
      );
      if (!r.artist) return null;
      return { name: r.artist.name, bio: stripHtml(r.artist.bio?.summary) };
    } catch {
      return null;
    }
  }

  /** Similar tracks (radio seed). Returns {artist,title} candidates. */
  async recommend(seed: { artist: string; title?: string }, limit = 20): Promise<{ artist: string; title: string }[]> {
    const c = await this.client();
    if (!c) return [];
    try {
      if (seed.title) {
        const r = await c.call<{ similartracks?: { track?: { name: string; artist: { name: string } }[] } }>(
          "track.getSimilar",
          { artist: seed.artist, track: seed.title, limit: String(limit), autocorrect: "1" },
          { signed: false },
        );
        return (r.similartracks?.track ?? []).map((t) => ({ artist: t.artist.name, title: t.name }));
      }
      // artist seed → similar artists' names; the caller resolves their tracks.
      const names = await this.similarArtists(seed.artist, limit);
      return names.map((artist) => ({ artist, title: "" }));
    } catch {
      return [];
    }
  }
}

export type { LastfmError };
```

- [ ] **Step 4: Run → pass.** `pnpm --filter @musex/mobile exec vitest run src/lastfm/lastfm-service.test.ts`.

- [ ] **Step 5: Verify + commit.** `pnpm check` → 0.
```bash
git add -A
git commit -m "feat(mobile): add LastfmService (connect, scrobble, love, similar, info, recommend)"
```

---

### Task 7: Wire LastfmService into the store

**Files:** Modify `packages/mobile/src/state/store.tsx`. Add dep `expo-web-browser`.

- [ ] **Step 1: Add the dep.** `pnpm --filter @musex/mobile exec expo install expo-web-browser`. (Native module → dev-client rebuild later.)

- [ ] **Step 2: Construct + expose `lastfm` on the store.** Read `store.tsx` first. Add:

```ts
import * as WebBrowser from "expo-web-browser";
import { LastfmService } from "../lastfm/lastfm-service";
import {
  clearSession, loadLastfmConfig, loadSecret, loadSessionKey,
  saveLastfmConfig, saveSecret, saveSessionKey, type LastfmConfig,
} from "../adapters/lastfm-store";
```

Construct once (like `taste`): an in-memory `lastfmConfig` ref seeded from `loadLastfmConfig()` in bootstrap, with `getConfig`/`setConfig` reading/writing it + persisting. `openAuth` = `async (url) => { await WebBrowser.openAuthSessionAsync(url, "musex://lastfm-callback"); }`. Construct:

```ts
const lastfm = useMemo(
  () =>
    new LastfmService({
      fetchFn: fetch,
      openAuth: async (url) => { await WebBrowser.openAuthSessionAsync(url, "musex://lastfm-callback"); },
      getConfig: async () => lastfmConfigRef.current,
      setConfig: async (cfg) => { lastfmConfigRef.current = cfg; await saveLastfmConfig(cfg); },
      getSecret: loadSecret, setSecret: saveSecret,
      getSessionKey: loadSessionKey, setSessionKey: saveSessionKey, clearSession,
    }),
  [],
);
```

Add to the `Store` interface + provider value: `lastfm: LastfmService`, `getLastfmConfig: () => LastfmConfig`, `setLastfmConfig: (cfg: LastfmConfig) => Promise<void>`, `connectLastfm: () => Promise<{ok:boolean;message:string}>`, `disconnectLastfm: () => Promise<void>`. Load the config + secret in the bootstrap effect (alongside `taste.init()`).

- [ ] **Step 3: Verify + commit.** `pnpm check` → 0 (the store typechecks with the new members; UI consuming them comes next).
```bash
git add -A
git commit -m "feat(mobile): wire LastfmService into the store"
```

---

### Task 8: Last.fm settings pane

**Files:** Create `packages/mobile/app/(tabs)/settings/lastfm.tsx`. Modify `packages/mobile/app/(tabs)/settings/_layout.tsx` (register the screen) + `settings/index.tsx` (link row).

- [ ] **Step 1: Register the screen** in `settings/_layout.tsx`: add `<Stack.Screen name="lastfm" options={{ title: "Last.fm" }} />`.

- [ ] **Step 2: Add a link row** in `settings/index.tsx` (mirror the existing Library row): `<Row title="Last.fm" subtitle={<connection status>} onPress={() => router.push("/(tabs)/settings/lastfm")} />`. Read the config via `getLastfmConfig()` for the subtitle.

- [ ] **Step 3: Build `lastfm.tsx`** — key + secret inputs (secret = `secureTextEntry`), Connect/Disconnect buttons, scrobbling + love-on-rating toggles (RN `Switch`), connection status. On Connect: persist key (config) + secret (secure-store), then `await connectLastfm()`, show the result message. On toggle change: `setLastfmConfig({...cfg, scrobbling/loveOnRating})`. Use the theme + `Row`/section patterns from `settings/index.tsx`. Secret is read/written via the store's secret setters (add a `setLastfmSecret` to the store, or have `lastfm.tsx` import `saveSecret` directly from the adapter — prefer routing through the store for consistency: add `setLastfmSecret: (s: string) => Promise<void>` to the store). Local component state holds the typed key/secret until Connect.

(No unit test — RN screen. Gate is `pnpm check`.)

- [ ] **Step 4: Verify + commit.** `pnpm check` → 0.
```bash
git add -A
git commit -m "feat(mobile): Last.fm settings + connect pane"
```

---

### Task 9: Scrobble + now-playing + love hooks

**Files:** Modify `packages/mobile/src/state/store.tsx` (the `session.subscribe` loop) and the rating call sites (`src/ui/TrackActionSheet.tsx`, `app/now-playing.tsx`).

- [ ] **Step 1: Now-playing + scrobble in the subscribe loop.** Read the current `session.subscribe` block (it calls `monitor.onState(s)` → `taste.recordPlay`). Track the current track + its start time across calls; on track CHANGE call `lastfm.updateNowPlaying(track)` and record `startedAtMs = Date.now()`; when `monitor.onState` returns a completed play with `kind === "full"`, call `lastfm.scrobble({ artistName, title }, startedAtMs)` for the track that just completed. Use refs (`prevTrackRef`, `startedAtRef`) so the closure sees the latest. Pseudocode to insert:

```ts
session.subscribe((s) => {
  const completed = monitor.onState(s);
  if (completed) {
    taste.recordPlay({ title: completed.title, artistName: completed.artistName }, completed.kind);
    if (completed.kind === "full")
      void lastfm.scrobble({ artistName: completed.artistName, title: completed.title }, startedAtRef.current);
  }
  const cur = s.queue ? s.queue.tracks[s.queue.index] : undefined;
  if (cur && cur.id !== prevTrackRef.current?.id) {
    prevTrackRef.current = cur;
    startedAtRef.current = Date.now();
    void lastfm.updateNowPlaying({ artistName: cur.artistName, title: cur.title, albumTitle: cur.albumTitle, durationMs: cur.durationMs });
  }
  // ... existing dispatch + lock-screen metadata
});
```
(`Date.now()` is fine in the app — only `@musex/core` forbids it.)

- [ ] **Step 2: Love on rating.** In the rating handler in `TrackActionSheet.tsx` (the `rate()` fn) and `now-playing.tsx` (its `rate()`), after the existing `gateway.rateItem` + `taste.recordTrackRating`, add: if `getLastfmConfig().loveOnRating`, then `r !== null && r >= 8 ? lastfm.love({artistName, title}) : lastfm.unlove({artistName, title})` (8 = `LOVED_RATING` = 4★). Pull `lastfm` + `getLastfmConfig` from `useStore()`.

- [ ] **Step 3: Verify + commit.** `pnpm check` → 0. (On-device: scrobbles + now-playing appear on last.fm; rating ≥4★ loves.)
```bash
git add -A
git commit -m "feat(mobile): scrobble, now-playing, and love-on-rating via last.fm"
```

---

### Task 10: Similar artists + bio on the artist page

**Files:** Modify `packages/mobile/app/(tabs)/library/albums.tsx`.

- [ ] **Step 1: Fetch similar + bio (gated on connected/configured).** In the existing artist-data effect, also call `lastfm.similarArtists(artist.name)` and `lastfm.artistInfo(artist.name)` (both no-op → `[]`/`null` when not configured). Resolve owned similar artists: match each returned name against the library's artists — reuse the cached artist list if available, else `gateway.search(library, name, token)` and take an artist whose name matches (case-insensitive); keep `{ name, artistId | null }`. Cap to ~12.

- [ ] **Step 2: Render the Similar rail + About in `ListHeaderComponent`** (below the Phase A header, above the albums): a horizontal `FlatList`/`ScrollView` of circular artist tiles (owned → `onPress` router.push to `library/albums?artistId=`; unowned → non-pressable, dimmed). Then an "About" section: the bio text, truncated to ~3 lines with a "more"/"less" toggle (local `expanded` state). Both sections omitted when empty. Match the theme + the mockup (layout B: similar rail, then albums, then About — so put similar in the header and the About section as a `ListFooterComponent`, OR keep all in the header with About after albums via a footer). Use `ListFooterComponent` for About so it sits below the albums.

- [ ] **Step 3: Verify + commit.** `pnpm check` → 0. (On-device: similar rail + bio render when connected.)
```bash
git add -A
git commit -m "feat(mobile): similar artists + bio on the artist page"
```

---

### Task 11: Radio mode

**Files:** Modify `packages/mobile/src/state/store.tsx` (radio state + top-up loop), `packages/mobile/src/ui/TrackActionSheet.tsx` ("Start radio" row), `packages/mobile/app/(tabs)/library/albums.tsx` (artist "Radio" button), `packages/mobile/app/now-playing.tsx` (Radio pill).

- [ ] **Step 1: Radio state + top-up in the store.** Add radio state (`{ seed: { artist: string; title?: string; label: string } | null } & RadioState` from core) and an exclude `Set<string>` (radioKey of recently-queued/played). Expose `startRadio(seed)`, `stopRadio()`, and a `radio` snapshot (active + seed label) for the UI. In the `session.subscribe` loop, after computing up-next count, if `shouldTopUp(radioState, upNextCount)`: call `lastfm.recommend(seed)` → for each candidate resolve a playable `Track` via `gateway.search(library, candidate.title || candidate.artist, token)` (match artist+title; for artist-only candidates take the artist's top track), filtering out `radioKey`s already in the exclude set; append the resolved tracks via `session.enqueueEnd(tracks)`, add their keys to the exclude set, and `radioState = advanceRadio(radioState, addedCount)`. Guard against re-entrancy (a `topUpInFlight` flag). `startRadio` seeds the exclude set with the last ~50 queue tracks and immediately triggers one top-up; `stopRadio` sets `active=false`. Starting a new collection (`playTracks`/`loadQueue` from album/playlist) calls `stopRadio()`.

- [ ] **Step 2: "Start radio" in the action sheet.** In `TrackActionSheet.tsx`, add a `Row` (lucide `Radio` icon) "Start radio" → `startRadio({ artist: track.artistName, title: track.title, label: track.title })` then `onClose()`. Pull `startRadio` from `useStore()`.

- [ ] **Step 3: "Radio" button on the artist page.** In `albums.tsx`, add a Radio button near the header → `startRadio({ artist: artist.name, label: artist.name })`.

- [ ] **Step 4: Radio pill on Now-Playing.** In `now-playing.tsx`, when `radio.active`, render a green pill near the title: `Radio · <seed label>` with a ✕ (lucide `X`) → `stopRadio()`. Pull `radio`/`stopRadio` from `useStore()`.

- [ ] **Step 5: Verify + commit.** `pnpm check` → 0. (On-device: Start radio fills the queue, tops up, pill stops it.)
```bash
git add -A
git commit -m "feat(mobile): Radio mode (start, auto-extend, stop)"
```

---

### Task 12: Final verification

- [ ] **Step 1:** `grep -rn "node:crypto" packages/core/src` → NO results (core stays Node-free; the protocol uses the Hasher port).
- [ ] **Step 2:** `pnpm check` → exit 0 across all packages.
- [ ] **Step 3:** Confirm `expo-web-browser` + `js-md5` are in `packages/mobile/package.json`. Note in the final report that the user must rebuild the dev client (`expo prebuild --platform ios` + `expo run:ios`) because `expo-web-browser` is native.

---

## Self-Review

**Spec coverage:** core promotion (Hasher + lastfm-protocol) → Task 1; radio coordination → Task 2; desktop re-point → Task 3; MD5 → Task 4; config/secrets → Task 5; LastfmService → Task 6; store wiring → Task 7; settings/connect → Task 8; scrobble+now-playing+love → Task 9; similar+bio → Task 10; radio UX → Task 11; verification → Task 12. ✓

**Placeholder scan:** No TBD/"handle edge cases". The "read the file first" notes in Tasks 7–11 are because those edits weave into existing files whose exact lines the implementer must see — each specifies the exact additions, types, and call shapes. ✓

**Type/symbol consistency:** `Hasher = (input: string) => string` used in core sign/client + mobile `md5Hasher` + desktop wrappers. `LastfmClient` ctor `{apiKey, secret, fetchFn, hasher}` consistent (desktop wrapper injects hasher to preserve its 3-arg shape). `LastfmConfig` fields match across store/service/settings. last.fm method strings + `{signed:false}`/`sk` usage match the grounded desktop shapes. `radioKey`/`shouldTopUp`/`advanceRadio`/`RadioState` consistent between Task 2 and Task 11. `LOVED_RATING`=8 (4★) for love-on-rating. ✓
