import type { Artist, Library } from "@musex/core";
import {
  advanceAttempts,
  albumKeyOf,
  artistKeyOf,
  budgetUsed,
  type CandidatePick,
  deepeningCandidates,
  type ExpansionEntry,
  type ExpansionParams,
  expansionParams,
  planPicks,
  type SimilarNeighbor,
} from "../../logic/taste-expansion.js";
import { type ExpansionPrefs, persistence } from "../adapters/persistence.js";
import type { PluginHost } from "../plugins/plugin-host.js";

/** Cycle cadence; the weekly budget is the real limiter, frequency just
 *  bounds how quickly stalls/landings are noticed. */
const CYCLE_MS = 6 * 60 * 60 * 1000;
/** First run after launch — after session restore + plugin load settle. */
const START_DELAY_MS = 2 * 60 * 1000;
/** How many near candidates get their own similar-list fetch (two-hop pool). */
const VIA_FETCH_MAX = 4;
/** Plan a few picks beyond the budget so lookup failures have replacements. */
const PICK_SPARES = 4;

export interface CoordinatorDeps {
  host: PluginHost;
  getLibrary(): Library | null;
  getToken(): string | null;
  listArtists(library: Library, token: string): Promise<Artist[]>;
  listAlbums(library: Library, artistId: string, token: string): Promise<{ title: string }[]>;
  topArtists(): { name: string; score: number }[];
  /** Taste-profile per-track stats; key = lower(artist)␟lower(title). */
  trackStats(): { key: string; plays: number }[];
}

export interface ExpansionStatus {
  running: boolean;
  lastRunAt: number | null;
  lastSummary: string | null;
}

/** Sum plays per artist from the taste profile's track stats. */
function aggregateArtistPlays(stats: { key: string; plays: number }[]): Map<string, number> {
  const plays = new Map<string, number>();
  for (const s of stats) {
    const artistKey = s.key.split("␟")[0];
    if (!artistKey) continue;
    plays.set(artistKey, (plays.get(artistKey) ?? 0) + s.plays);
  }
  return plays;
}

function toNeighbors(items: { name: string; match?: number }[]): SimilarNeighbor[] {
  return items.map((i) => ({ name: i.name, ...(i.match !== undefined ? { match: i.match } : {}) }));
}

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Host-owned taste-expansion coordinator: advances attempt lifecycles and,
 *  while under the weekly budget, requests new discovery/deepening picks.
 *  All decisions are made by the pure logic/taste-expansion module; this
 *  class only fetches inputs, applies actions, and persists the ledger. */
export class ExpansionCoordinator {
  private running = false;
  private lastRunAt: number | null = null;
  private lastSummary: string | null = null;
  private startTimer: ReturnType<typeof setTimeout> | undefined;
  private cycleTimer: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly deps: CoordinatorDeps) {}

  start(): void {
    this.startTimer = setTimeout(() => void this.runCycle(), START_DELAY_MS);
    this.cycleTimer = setInterval(() => void this.runCycle(), CYCLE_MS);
  }

  dispose(): void {
    if (this.startTimer !== undefined) clearTimeout(this.startTimer);
    if (this.cycleTimer !== undefined) clearInterval(this.cycleTimer);
  }

  status(): ExpansionStatus {
    return { running: this.running, lastRunAt: this.lastRunAt, lastSummary: this.lastSummary };
  }

  /** "Not for me": blacklist the artist forever; unmonitor anything we asked
   *  the provider for. */
  async reject(artistName: string): Promise<void> {
    const key = artistKeyOf(artistName);
    const ledger = persistence.getExpansionLedger();
    const now = Date.now();
    for (const e of ledger) {
      if (e.artistKey !== key || e.state === "rejected") continue;
      if (e.providerId !== undefined && e.providerRef !== undefined) {
        await this.deps.host.cancelAlbum(e.providerId, e.providerRef);
      }
      e.state = "rejected";
      e.rejectedAt = now;
    }
    persistence.setExpansionLedger(ledger);
    console.log(`[expansion] rejected: ${artistName}`);
  }

  async runCycle(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      this.lastSummary = await this.doCycle();
      console.log(`[expansion] cycle done: ${this.lastSummary}`);
    } catch (err) {
      this.lastSummary = `Cycle failed: ${errText(err)}`;
      console.error("[expansion] cycle failed:", err);
    } finally {
      this.running = false;
      this.lastRunAt = Date.now();
    }
  }

  private async doCycle(): Promise<string> {
    const prefs = persistence.getExpansionPrefs();
    if (!prefs.enabled) return "Disabled";
    const library = this.deps.getLibrary();
    const token = this.deps.getToken();
    if (library === null || token === null) return "Not signed in";
    const caps = this.deps.host.expansionCapabilities();
    if (!caps.similar || !caps.acquisition) {
      return `Waiting for providers (similar: ${caps.similar ? "ok" : "missing"}, acquisition: ${caps.acquisition ? "ok" : "missing"})`;
    }

    const params = expansionParams(prefs.aggressiveness);
    const ledger = persistence.getExpansionLedger();
    const now = Date.now();

    const artists = await this.deps.listArtists(library, token);
    const libraryArtistKeys = new Set(artists.map((a) => artistKeyOf(a.name)));

    // 1. Advance lifecycles (land / retry / abandon).
    const advanced = await this.advance(ledger, library, token, artists, libraryArtistKeys, now);

    // 2. Spend remaining budget: deepening first (bets that already paid off),
    //    then fresh discovery.
    let remaining = Math.max(0, prefs.albumsPerWeek - budgetUsed(ledger, now));
    let requested = 0;

    if (remaining > 0) {
      const artistPlays = aggregateArtistPlays(this.deps.trackStats());
      for (const landed of deepeningCandidates({ ledger, artistPlays, params })) {
        if (remaining <= 0) break;
        if (await this.deepen(landed, params, library, token, artists, ledger, now)) {
          remaining--;
          requested++;
        }
      }
    }

    if (remaining > 0) {
      const made = await this.discover(ledger, libraryArtistKeys, params, remaining, now);
      requested += made;
    }

    persistence.setExpansionLedger(ledger);
    return (
      `${requested} requested, ${advanced.landed} landed, ` +
      `${advanced.retried} retried, ${advanced.abandoned} abandoned` +
      (remaining <= 0 && requested === 0 ? " (weekly budget spent)" : "")
    );
  }

  private async advance(
    ledger: ExpansionEntry[],
    library: Library,
    token: string,
    artists: Artist[],
    libraryArtistKeys: Set<string>,
    now: number,
  ): Promise<{ landed: number; retried: number; abandoned: number }> {
    // Deepening attempts land on ALBUM presence (their artist is owned by
    // definition) — fetch the album list only for those few artists.
    const ownedAlbumKeys = new Set<string>();
    for (const e of ledger) {
      if (!e.deepening || e.state !== "requested") continue;
      const artist = artists.find((a) => artistKeyOf(a.name) === e.artistKey);
      if (artist === undefined) continue;
      try {
        const albums = await this.deps.listAlbums(library, artist.id, token);
        for (const al of albums) ownedAlbumKeys.add(albumKeyOf(e.artistName, al.title));
      } catch (err) {
        console.warn(`[expansion] album list failed for ${e.artistName}:`, errText(err));
      }
    }

    const status = await this.deps.host.acquisitionStatus();
    const inFlightArtistKeys = new Set(
      status
        .filter((s) => s.state === "downloading" || s.state === "requested")
        .map((s) => artistKeyOf(s.artistName)),
    );

    const actions = advanceAttempts({
      ledger,
      libraryArtistKeys,
      ownedAlbumKeys,
      inFlightArtistKeys,
      now,
    });
    for (const e of actions.land) {
      e.state = "landed";
      e.landedAt = now;
      console.log(`[expansion] landed: ${e.artistName} — ${e.albumTitle}`);
    }
    for (const e of actions.retry) {
      e.retried = true;
      e.requestedAt = now;
      e.note = "not found yet — search retried";
      if (e.providerId !== undefined && e.providerRef !== undefined) {
        try {
          await this.deps.host.acquireAlbum(e.providerId, e.providerRef);
        } catch (err) {
          // Leave it requested; the next stall window abandons it.
          console.warn(`[expansion] retry failed for ${e.artistName}:`, errText(err));
        }
      }
    }
    for (const e of actions.abandon) {
      if (e.providerId !== undefined && e.providerRef !== undefined) {
        await this.deps.host.cancelAlbum(e.providerId, e.providerRef);
      }
      e.state = "abandoned";
      e.abandonedAt = now;
      e.note = "never found — budget slot refunded";
      console.log(`[expansion] abandoned: ${e.artistName} — ${e.albumTitle}`);
    }
    return {
      landed: actions.land.length,
      retried: actions.retry.length,
      abandoned: actions.abandon.length,
    };
  }

  /** Fetch seed similar lists (+ a few via lists for the two-hop pool), plan
   *  picks, and request them until the budget runs out. Returns how many were
   *  actually requested. */
  private async discover(
    ledger: ExpansionEntry[],
    ownedArtistKeys: Set<string>,
    params: ExpansionParams,
    budget: number,
    now: number,
  ): Promise<number> {
    const seeds = this.deps.topArtists().slice(0, params.seedCount);
    if (seeds.length === 0) return 0;

    const similarOf = new Map<string, SimilarNeighbor[]>();
    for (const seed of seeds) {
      similarOf.set(
        artistKeyOf(seed.name),
        toNeighbors(await this.deps.host.similarArtistsScored(seed.name)),
      );
    }
    // Expand the strongest near candidates so planPicks has a two-hop pool.
    const vias = planPicks({
      seeds,
      similarOf,
      ownedArtistKeys,
      ledger,
      params: { ...params, farShare: 0 },
      count: VIA_FETCH_MAX,
    });
    for (const via of vias) {
      const key = artistKeyOf(via.artistName);
      if (!similarOf.has(key)) {
        similarOf.set(key, toNeighbors(await this.deps.host.similarArtistsScored(via.artistName)));
      }
    }

    const picks = planPicks({
      seeds,
      similarOf,
      ownedArtistKeys,
      ledger,
      params,
      count: budget + PICK_SPARES,
    });

    let requested = 0;
    for (const pick of picks) {
      if (requested >= budget) break;
      const entry = await this.requestPick(pick, now);
      if (entry === null) continue; // transient lookup failure — retry next cycle
      ledger.push(entry);
      if (entry.state === "requested") requested++;
    }
    return requested;
  }

  /** Resolve a pick to its entry-point album and request it. A provider that
   *  ANSWERS "no albums" abandons the artist (blacklisted, slot free); a
   *  provider that ERRORS (metadata-service timeout/503) returns null so the
   *  pick is simply retried on a later cycle — never blacklisted. */
  private async requestPick(pick: CandidatePick, now: number): Promise<ExpansionEntry | null> {
    const base: ExpansionEntry = {
      artistKey: artistKeyOf(pick.artistName),
      artistName: pick.artistName,
      albumTitle: "",
      state: "suggested",
      retried: false,
      provenance: pick.provenance,
      deepening: false,
      createdAt: now,
    };

    let lookup: Awaited<ReturnType<PluginHost["lookupArtistAlbumsStrict"]>>;
    try {
      lookup = await this.deps.host.lookupArtistAlbumsStrict(pick.artistName);
    } catch (err) {
      console.warn(
        `[expansion] lookup failed for ${pick.artistName} — will retry next cycle:`,
        errText(err),
      );
      return null;
    }
    if (lookup.length === 0) {
      return {
        ...base,
        albumTitle: "(no albums found)",
        state: "abandoned",
        abandonedAt: now,
        note: "not known to the acquisition provider",
      };
    }

    // Entry-point album: the provider's top-albums ranking when available
    // (matched against the acquirable discography), else the lookup's first
    // (search-ranked) album.
    const top = await this.deps.host.topAlbums(pick.artistName);
    const byTitle = (title: string) =>
      lookup.find((al) => al.title.trim().toLowerCase() === title.trim().toLowerCase());
    const chosen = top.map((t) => byTitle(t.title)).find((al) => al !== undefined) ?? lookup[0];
    if (chosen === undefined)
      return { ...base, albumTitle: "(no albums found)", state: "abandoned", abandonedAt: now };

    const entry: ExpansionEntry = {
      ...base,
      albumTitle: chosen.title,
      providerRef: chosen.providerRef,
      providerId: chosen.providerId,
    };
    try {
      await this.deps.host.acquireAlbum(chosen.providerId, chosen.providerRef);
      entry.state = "requested";
      entry.requestedAt = now;
      console.log(
        `[expansion] requested: ${entry.artistName} — ${entry.albumTitle} ` +
          `(seed ${entry.provenance.seed}, match ${entry.provenance.match.toFixed(2)}, hop ${entry.provenance.hop})`,
      );
    } catch (err) {
      entry.state = "abandoned";
      entry.abandonedAt = now;
      entry.note = `request failed: ${errText(err)}`;
      console.warn(`[expansion] request failed for ${entry.artistName}:`, errText(err));
    }
    return entry;
  }

  /** A landed bet paid off — acquire one more album (or, at aggressive
   *  settings, monitor the whole artist). Returns true when a budget slot was
   *  consumed. */
  private async deepen(
    landed: ExpansionEntry,
    params: ExpansionParams,
    library: Library,
    token: string,
    artists: Artist[],
    ledger: ExpansionEntry[],
    now: number,
  ): Promise<boolean> {
    if (params.deepenMonitorsArtist) {
      try {
        await this.deps.host.acquireArtistByName(landed.artistName);
        // Monitoring is established the moment the call succeeds — the entry
        // records the action; individual downloads show in the Lidarr queue.
        ledger.push({
          artistKey: landed.artistKey,
          artistName: landed.artistName,
          albumTitle: "(entire discography)",
          state: "landed",
          retried: false,
          provenance: landed.provenance,
          deepening: true,
          createdAt: now,
          requestedAt: now,
          landedAt: now,
          note: "deepening: now monitoring everything by this artist",
        });
        console.log(`[expansion] deepening (monitor all): ${landed.artistName}`);
        return true;
      } catch (err) {
        console.warn(`[expansion] monitor-artist failed for ${landed.artistName}:`, errText(err));
        return false;
      }
    }

    // Acquire the next-best album we don't own and haven't tried.
    const artist = artists.find((a) => artistKeyOf(a.name) === landed.artistKey);
    const ownedTitles = new Set<string>();
    if (artist !== undefined) {
      try {
        for (const al of await this.deps.listAlbums(library, artist.id, token)) {
          ownedTitles.add(al.title.trim().toLowerCase());
        }
      } catch (err) {
        console.warn(`[expansion] album list failed for ${landed.artistName}:`, errText(err));
        return false;
      }
    }
    const triedTitles = new Set(
      ledger
        .filter((e) => e.artistKey === landed.artistKey)
        .map((e) => e.albumTitle.trim().toLowerCase()),
    );

    let lookup: Awaited<ReturnType<PluginHost["lookupArtistAlbumsStrict"]>>;
    try {
      lookup = await this.deps.host.lookupArtistAlbumsStrict(landed.artistName);
    } catch (err) {
      console.warn(
        `[expansion] deepening lookup failed for ${landed.artistName} — will retry next cycle:`,
        errText(err),
      );
      return false;
    }
    const top = await this.deps.host.topAlbums(landed.artistName);
    const ranked = [
      ...top
        .map((t) =>
          lookup.find((al) => al.title.trim().toLowerCase() === t.title.trim().toLowerCase()),
        )
        .filter((al) => al !== undefined),
      ...lookup,
    ];
    const next = ranked.find((al) => {
      const t = al.title.trim().toLowerCase();
      return !ownedTitles.has(t) && !triedTitles.has(t);
    });
    if (next === undefined) return false;

    const entry: ExpansionEntry = {
      artistKey: landed.artistKey,
      artistName: landed.artistName,
      albumTitle: next.title,
      providerRef: next.providerRef,
      providerId: next.providerId,
      state: "suggested",
      retried: false,
      provenance: landed.provenance,
      deepening: true,
      createdAt: now,
      note: "deepening: you kept playing this artist",
    };
    try {
      await this.deps.host.acquireAlbum(next.providerId, next.providerRef);
      entry.state = "requested";
      entry.requestedAt = now;
      console.log(`[expansion] deepening: ${landed.artistName} — ${next.title}`);
    } catch (err) {
      entry.state = "abandoned";
      entry.abandonedAt = now;
      entry.note = `deepening request failed: ${errText(err)}`;
    }
    ledger.push(entry);
    return entry.state === "requested";
  }
}
