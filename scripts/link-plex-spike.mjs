#!/usr/bin/env node
// Throwaway spike helper: links this machine to your Plex account via the PIN
// flow and caches a token + a working server base URL to a GITIGNORED file
// (.plex-spike-credentials.json) so the transcode-download spike can iterate
// without re-linking each run. Plaintext, local only — delete when the spike is
// done (the real app stores the token encrypted via safeStorage).
//
// Run:  node scripts/link-plex-spike.mjs
// Then follow the plex.tv/link prompt (short code).

import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const CRED_PATH = join(process.cwd(), ".plex-spike-credentials.json");
const CLIENT_ID = randomUUID();
const PRODUCT = "musex-transcode-spike";

const PLEX_HEADERS = {
  accept: "application/json",
  "X-Plex-Product": PRODUCT,
  "X-Plex-Client-Identifier": CLIENT_ID,
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** plex.tv can be slow / flaky (504s); retry transient failures, fail on 401. */
async function plexFetch(url, init, { retries = 4 } = {}) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, init);
      if (res.status === 401) throw new Error(`401 unauthorized: ${url}`);
      if (res.status >= 500) {
        lastErr = new Error(`${res.status} from ${url}`);
        await sleep(1500 * (i + 1));
        continue;
      }
      return res;
    } catch (e) {
      lastErr = e;
      await sleep(1500 * (i + 1));
    }
  }
  throw lastErr ?? new Error(`failed: ${url}`);
}

async function createPin() {
  const res = await plexFetch("https://plex.tv/api/v2/pins?strong=false", {
    method: "POST",
    headers: PLEX_HEADERS,
  });
  if (!res.ok) throw new Error(`createPin failed: ${res.status}`);
  return res.json(); // { id, code, authToken: null, ... }
}

async function pollPin(id) {
  for (;;) {
    const res = await plexFetch(`https://plex.tv/api/v2/pins/${id}`, { headers: PLEX_HEADERS });
    if (res.ok) {
      const data = await res.json();
      if (data.authToken) return data.authToken;
    }
    await sleep(2000);
  }
}

/** Find an owned music-capable server and a reachable base URL. */
async function resolveServer(token) {
  const res = await plexFetch(
    "https://plex.tv/api/v2/resources?includeHttps=1&includeRelay=1",
    { headers: { ...PLEX_HEADERS, "X-Plex-Token": token } },
  );
  if (!res.ok) throw new Error(`resources failed: ${res.status}`);
  const resources = await res.json();
  const servers = resources.filter(
    (r) => Array.isArray(r.provides ? r.provides.split(",") : []) && r.provides?.includes("server"),
  );
  const owned = servers.filter((s) => s.owned);
  const candidates = (owned.length ? owned : servers).flatMap((s) =>
    (s.connections ?? []).map((c) => ({ server: s, uri: c.uri, local: c.local })),
  );
  // Prefer local connections first, then anything else.
  candidates.sort((a, b) => Number(b.local) - Number(a.local));
  for (const cand of candidates) {
    try {
      const probe = await fetch(`${cand.uri}/?X-Plex-Token=${encodeURIComponent(cand.server.accessToken)}`, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(5000),
      });
      if (probe.ok || probe.status === 401) {
        return {
          baseUrl: cand.uri,
          serverToken: cand.server.accessToken,
          serverId: cand.server.clientIdentifier,
          serverName: cand.server.name,
        };
      }
    } catch {
      // unreachable connection — try the next
    }
  }
  throw new Error("no reachable server connection found");
}

async function main() {
  console.log("Creating Plex PIN…");
  const pin = await createPin();
  console.log("\n  → Open https://plex.tv/link and enter code:  " + pin.code + "\n");
  console.log("Waiting for you to link (polling)…");
  const accountToken = await pollPin(pin.id);
  console.log("Linked. Resolving a reachable server…");
  const server = await resolveServer(accountToken);
  const cred = {
    accountToken,
    serverToken: server.serverToken,
    clientId: CLIENT_ID,
    baseUrl: server.baseUrl,
    serverId: server.serverId,
    serverName: server.serverName,
    linkedAt: new Date().toISOString(),
  };
  writeFileSync(CRED_PATH, JSON.stringify(cred, null, 2));
  console.log(`\nCached credentials → ${CRED_PATH}`);
  console.log(`Server: ${server.serverName}  (${server.baseUrl})`);
  console.log("This file is gitignored. Delete it when the spike is done.");
}

main().catch((e) => {
  console.error("link failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
