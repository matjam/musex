import { KEY_SEPARATOR, mergeDiscography } from "@musex/core";
import type {
  AcquirableAlbum,
  AcquisitionProvider,
  AcquisitionStatusItem,
  ArtistInfo,
  Disposable,
  ExternalArtistResult,
  PluginEvents,
  RecommendContext,
  RecommendedTrack,
  Section,
  SectionContext,
  SectionProvider,
  SimilarItem,
  SimilarProvider,
  TrackAction,
  TrackDetailProvider,
  TrackInfo,
  TrackRecommender,
} from "@musex/plugin-api";

// ── Registry types (moved verbatim from plugin-context.ts) ───────────────────

export interface PluginEventSubscriber {
  pluginId: string;
  event: keyof PluginEvents;
  handler: (payload: PluginEvents[keyof PluginEvents]) => void;
}
export interface RegisteredSectionProvider {
  pluginId: string;
  target: "discover" | "home";
  provider: SectionProvider;
}
export interface RegisteredTrackAction {
  pluginId: string;
  action: TrackAction;
}
export interface RegisteredTrackDetailProvider {
  pluginId: string;
  provider: TrackDetailProvider;
}
export interface RegisteredTrackRecommender {
  pluginId: string;
  recommender: TrackRecommender;
}
export interface RegisteredSimilarProvider {
  pluginId: string;
  provider: SimilarProvider;
}
export interface RegisteredAcquisitionProvider {
  pluginId: string;
  provider: AcquisitionProvider;
}

/** Registrations from all active plugins and first-party in-process providers. */
export interface PluginRegistry {
  eventSubscribers: PluginEventSubscriber[];
  sectionProviders: RegisteredSectionProvider[];
  trackActions: RegisteredTrackAction[];
  trackDetailProviders: RegisteredTrackDetailProvider[];
  trackRecommenders: RegisteredTrackRecommender[];
  similarProviders: RegisteredSimilarProvider[];
  acquisitionProviders: RegisteredAcquisitionProvider[];
}

export function createPluginRegistry(): PluginRegistry {
  return {
    eventSubscribers: [],
    sectionProviders: [],
    trackActions: [],
    trackDetailProviders: [],
    trackRecommenders: [],
    similarProviders: [],
    acquisitionProviders: [],
  };
}

/** Push `entry` into a registry list, returning a Disposable that removes it. */
function register<T>(list: T[], entry: T, track: (d: Disposable) => void): Disposable {
  list.push(entry);
  const d: Disposable = {
    dispose() {
      const i = list.indexOf(entry);
      if (i !== -1) list.splice(i, 1);
    },
  };
  track(d);
  return d;
}

// ── Fan-out constants (moved verbatim from plugin-host.ts) ───────────────────

/** Per-provider budget for section/detail fan-outs — a slow plugin must never
 *  hold the whole view hostage. */
const PROVIDER_TIMEOUT_MS = 8_000;

/** Reject after `ms` (the underlying promise keeps running; we just stop
 *  waiting). The timer is cleared on settle so it never holds the process. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/** Cap on merged Similar-panel results across all providers. */
const SIMILAR_ITEMS_MAX = 24;

/** Acquisition lookups (metadata searches via an acquisition plugin) are slow —
 *  a bigger budget than the section/detail fan-outs. Tests override via providerTimeoutMs. */
const ACQUISITION_TIMEOUT_MS = 15_000;

/** Cap on federated external artist search results (one search section). */
const EXTERNAL_ARTIST_RESULTS_MAX = 10;

/** Dedupe/exclusion key for recommendations: lower(artist)␟lower(title ?? "").
 *  The same artist+title join key the taste profile and smart playlists use. */
function recommendationKey(artist: string, title: string | undefined): string {
  return `${artist.toLowerCase()}${KEY_SEPARATOR}${(title ?? "").toLowerCase()}`;
}

// ── ProviderHub ──────────────────────────────────────────────────────────────

export interface ProviderHubDeps {
  /** Per-provider fan-out budget override (tests); defaults to 8s / 15s for acquisition. */
  providerTimeoutMs?: number;
}

/**
 * Runtime-owned hub that holds the registry of all provider contributions
 * (from both plugins and first-party in-process registrations) and exposes
 * the origin-agnostic fan-out methods previously in PluginHost.
 *
 * First-party registration (e.g. core:lastfm) goes directly via the
 * `registerSimilarProvider` / `registerTrackRecommender` / etc. methods.
 * Plugin contributions reach the hub through `buildPluginContext` (which calls
 * these same methods keyed by the plugin's manifest id).
 */
export class ProviderHub {
  readonly registry: PluginRegistry = createPluginRegistry();

  constructor(private readonly deps: ProviderHubDeps = {}) {}

  // ── First-party registration API ─────────────────────────────────────────

  registerSimilarProvider(id: string, provider: SimilarProvider): Disposable {
    return register(
      this.registry.similarProviders,
      { pluginId: id, provider },
      // no external tracker needed — the Disposable itself is returned to the caller
      () => {},
    );
  }

  registerTrackRecommender(id: string, recommender: TrackRecommender): Disposable {
    return register(this.registry.trackRecommenders, { pluginId: id, recommender }, () => {});
  }

  registerAcquisitionProvider(id: string, provider: AcquisitionProvider): Disposable {
    return register(this.registry.acquisitionProviders, { pluginId: id, provider }, () => {});
  }

  contributeSections(
    id: string,
    target: "discover" | "home",
    provider: SectionProvider,
  ): Disposable {
    return register(this.registry.sectionProviders, { pluginId: id, target, provider }, () => {});
  }

  contributeTrackAction(id: string, action: TrackAction): Disposable {
    return register(this.registry.trackActions, { pluginId: id, action }, () => {});
  }

  contributeTrackDetail(id: string, provider: TrackDetailProvider): Disposable {
    return register(this.registry.trackDetailProviders, { pluginId: id, provider }, () => {});
  }

  onEvent<K extends keyof PluginEvents>(
    id: string,
    event: K,
    handler: (payload: PluginEvents[K]) => void,
  ): Disposable {
    const subscriber: PluginEventSubscriber = {
      pluginId: id,
      event,
      handler: handler as (payload: PluginEvents[keyof PluginEvents]) => void,
    };
    return register(this.registry.eventSubscribers, subscriber, () => {});
  }

  // ── Internal registration helper used by buildPluginContext ──────────────

  /** Register an entry into a list and track the resulting Disposable via
   *  `trackDisposable` (called by the plugin host to track per-plugin cleanup). */
  registerTracked<T>(list: T[], entry: T, trackDisposable: (d: Disposable) => void): Disposable {
    return register(list, entry, trackDisposable);
  }

  // ── Fan-out: events ──────────────────────────────────────────────────────

  /** Fan an event out to every subscriber of that event, isolating failures —
   *  a throwing plugin handler is logged and never blocks the rest. */
  dispatchEvent<K extends keyof PluginEvents>(event: K, payload: PluginEvents[K]): void {
    // Copy: a handler may dispose (or add) subscriptions while we iterate.
    for (const sub of [...this.registry.eventSubscribers]) {
      if (sub.event !== event) continue;
      try {
        sub.handler(payload);
      } catch (err) {
        console.error(`[providers] ${sub.pluginId} "${event}" handler threw:`, err);
      }
    }
  }

  // ── Fan-out: sections ────────────────────────────────────────────────────

  /** Fan out to every section provider registered for `target`, isolating
   *  failures: a throwing or slow (>timeout) provider is logged and skipped. */
  async getSections(
    target: "discover" | "home",
    ctx: SectionContext,
  ): Promise<{ pluginId: string; sections: Section[] }[]> {
    const timeoutMs = this.deps.providerTimeoutMs ?? PROVIDER_TIMEOUT_MS;
    const providers = this.registry.sectionProviders.filter((p) => p.target === target);
    const results = await Promise.all(
      providers.map(async (p) => {
        try {
          const sections = await withTimeout(p.provider.getSections(ctx), timeoutMs);
          return { pluginId: p.pluginId, sections };
        } catch (err) {
          console.error(
            `[providers] ${p.pluginId} section provider "${p.provider.id}" failed:`,
            err,
          );
          return null;
        }
      }),
    );
    return results.filter((r) => r !== null);
  }

  // ── Fan-out: radio ───────────────────────────────────────────────────────

  /** Fan out to every registered track recommender (radio), isolating throwing
   *  and slow recommenders; merge, dedupe by lower(artist)␟lower(title ?? ""),
   *  and drop suggestions matching an `exclude` entry. Exclusion is an EXACT
   *  key match: an artist-level suggestion (no title, key `artist␟`) is only
   *  excluded by an exclude entry with an empty title, never by that artist's
   *  excluded tracks — the host's resolution step filters those per track. */
  async recommendTracks(ctx: RecommendContext): Promise<RecommendedTrack[]> {
    const timeoutMs = this.deps.providerTimeoutMs ?? PROVIDER_TIMEOUT_MS;
    const results = await Promise.all(
      this.registry.trackRecommenders.map(async (r) => {
        try {
          const recs = await withTimeout(r.recommender.recommend(ctx), timeoutMs);
          return Array.isArray(recs) ? recs : [];
        } catch (err) {
          console.error(`[providers] ${r.pluginId} recommender "${r.recommender.id}" failed:`, err);
          return [];
        }
      }),
    );
    const excluded = new Set(ctx.exclude.map((e) => recommendationKey(e.artist, e.title)));
    const seen = new Set<string>();
    const merged: RecommendedTrack[] = [];
    for (const rec of results.flat()) {
      // Full-trust, but a recommender can still return junk — drop it here.
      if (typeof rec?.artistName !== "string" || rec.artistName.length === 0) continue;
      if (rec.title !== undefined && typeof rec.title !== "string") continue;
      const key = recommendationKey(rec.artistName, rec.title);
      if (seen.has(key) || excluded.has(key)) continue;
      seen.add(key);
      merged.push(rec);
    }
    return merged;
  }

  // ── Fan-out: similar panel ───────────────────────────────────────────────

  /** Fan out a Similar-panel request to every provider implementing the
   *  matching method (artist → similarArtists, track → similarTracks),
   *  isolating throwing/slow providers; merge, dedupe by
   *  lower(name)␟lower(artistName ?? ""), cap at SIMILAR_ITEMS_MAX. */
  async getSimilar(
    kind: "artist" | "track",
    seed: { name?: string; title?: string; artist?: string },
  ): Promise<SimilarItem[]> {
    const timeoutMs = this.deps.providerTimeoutMs ?? PROVIDER_TIMEOUT_MS;
    const results = await Promise.all(
      this.registry.similarProviders.map(async (p) => {
        try {
          let items: SimilarItem[] | undefined;
          if (kind === "artist" && p.provider.similarArtists && seed.name !== undefined) {
            items = await withTimeout(p.provider.similarArtists(seed.name), timeoutMs);
          } else if (
            kind === "track" &&
            p.provider.similarTracks &&
            seed.title !== undefined &&
            seed.artist !== undefined
          ) {
            items = await withTimeout(
              p.provider.similarTracks({ title: seed.title, artist: seed.artist }),
              timeoutMs,
            );
          }
          return Array.isArray(items) ? items : [];
        } catch (err) {
          console.error(
            `[providers] ${p.pluginId} similar provider "${p.provider.id}" failed:`,
            err,
          );
          return [];
        }
      }),
    );
    const seen = new Set<string>();
    const merged: SimilarItem[] = [];
    for (const item of results.flat()) {
      if (merged.length >= SIMILAR_ITEMS_MAX) break;
      // Full-trust, but a provider can still return junk — drop it here.
      if (typeof item?.name !== "string" || item.name.length === 0) continue;
      if (item.artistName !== undefined && typeof item.artistName !== "string") continue;
      const key = recommendationKey(item.name, item.artistName);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(item);
    }
    return merged;
  }

  // ── Acquisition ──────────────────────────────────────────────────────────

  /** True when any provider registered an AcquisitionProvider — the renderer
   *  uses this to reroute external-artist clicks into the in-app view. */
  acquisitionAvailable(): boolean {
    return this.registry.acquisitionProviders.length > 0;
  }

  /** Ask providers for an artist's acquirable discography, SEQUENTIALLY in
   *  registration order: the first provider returning a non-empty (post
   *  junk-filter) array wins. Throwing/slow providers are logged and skipped.
   *  Items are tagged with the owning pluginId so acquire can route back. */
  async lookupArtistAlbums(
    artistName: string,
  ): Promise<(AcquirableAlbum & { providerId: string })[]> {
    return this.lookupAlbums(artistName, false);
  }

  /** Like lookupArtistAlbums, but when EVERY provider errored the failure
   *  THROWS instead of blending into "no albums". Taste expansion needs the
   *  distinction: a metadata-service hiccup (timeout, SkyHook 503) must defer
   *  the pick to the next cycle, not permanently blacklist the artist —
   *  [] still means "providers answered: artist genuinely unknown". */
  async lookupArtistAlbumsStrict(
    artistName: string,
  ): Promise<(AcquirableAlbum & { providerId: string })[]> {
    return this.lookupAlbums(artistName, true);
  }

  private async lookupAlbums(
    artistName: string,
    strict: boolean,
  ): Promise<(AcquirableAlbum & { providerId: string })[]> {
    const timeoutMs = this.deps.providerTimeoutMs ?? ACQUISITION_TIMEOUT_MS;
    let attempted = 0;
    let failed = 0;
    for (const p of this.registry.acquisitionProviders) {
      attempted++;
      let items: AcquirableAlbum[];
      try {
        const res = await withTimeout(p.provider.lookupArtistAlbums(artistName), timeoutMs);
        items = Array.isArray(res) ? res : [];
      } catch (err) {
        failed++;
        console.error(
          `[providers] ${p.pluginId} acquisition provider "${p.provider.id}" lookup failed:`,
          err,
        );
        continue;
      }
      const tagged: (AcquirableAlbum & { providerId: string })[] = [];
      for (const item of items) {
        // Full-trust, but a provider can still return junk — drop it here.
        if (typeof item?.title !== "string" || item.title.length === 0) continue;
        if (typeof item.artistName !== "string" || item.artistName.length === 0) continue;
        if (typeof item.providerRef !== "string" || item.providerRef.length === 0) continue;
        tagged.push({ ...item, providerId: p.pluginId });
      }
      if (tagged.length > 0) return tagged;
    }
    if (strict && attempted > 0 && failed === attempted) {
      throw new Error(`every acquisition provider failed looking up "${artistName}"`);
    }
    return [];
  }

  /** Route an acquire to the provider that produced the lookup item. Unknown
   *  providerId → throw; provider failures are rethrown with the plugin id
   *  prefixed so the renderer's error surface says who failed. */
  async acquireAlbum(providerId: string, providerRef: string): Promise<void> {
    const entry = this.registry.acquisitionProviders.find((p) => p.pluginId === providerId);
    if (!entry) throw new Error(`unknown acquisition provider "${providerId}"`);
    try {
      await entry.provider.acquireAlbum(providerRef);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`[plugin:${entry.pluginId}] acquire failed: ${msg}`);
    }
    // Acquiring an album makes its artist monitored in the acquisition plugin
    // (and the expansion coordinator acquires in the background) — drop the badge cache.
    this.monitoredCache = null;
  }

  /** Federated external artist search: ask providers implementing
   *  searchArtists, SEQUENTIALLY in registration order — the first provider
   *  returning a non-empty (post junk-filter) array wins. Throwing/slow
   *  providers are logged and skipped. Items are tagged with the owning
   *  pluginId (acquireArtist routes back) and capped. */
  async searchExternalArtists(
    term: string,
  ): Promise<(ExternalArtistResult & { providerId: string })[]> {
    const timeoutMs = this.deps.providerTimeoutMs ?? ACQUISITION_TIMEOUT_MS;
    for (const p of this.registry.acquisitionProviders) {
      const search = p.provider.searchArtists;
      if (search === undefined) continue;
      let items: ExternalArtistResult[];
      try {
        const res = await withTimeout(search.call(p.provider, term), timeoutMs);
        items = Array.isArray(res) ? res : [];
      } catch (err) {
        console.error(
          `[providers] ${p.pluginId} acquisition provider "${p.provider.id}" artist search failed:`,
          err,
        );
        continue;
      }
      const tagged: (ExternalArtistResult & { providerId: string })[] = [];
      for (const item of items) {
        if (tagged.length >= EXTERNAL_ARTIST_RESULTS_MAX) break;
        // Full-trust, but a provider can still return junk — drop it here.
        if (typeof item?.name !== "string" || item.name.length === 0) continue;
        if (typeof item.providerRef !== "string" || item.providerRef.length === 0) continue;
        tagged.push({ ...item, providerId: p.pluginId });
      }
      if (tagged.length > 0) return tagged;
    }
    return [];
  }

  /** Route a monitor-entire-artist request to the provider that produced the
   *  search result. Unknown providerId / provider without acquireArtist →
   *  throw; provider failures are rethrown with the plugin id prefixed. */
  async acquireArtist(providerId: string, providerRef: string): Promise<void> {
    const entry = this.registry.acquisitionProviders.find((p) => p.pluginId === providerId);
    if (!entry) throw new Error(`unknown acquisition provider "${providerId}"`);
    const acquire = entry.provider.acquireArtist;
    if (acquire === undefined) {
      throw new Error(`acquisition provider "${providerId}" cannot monitor artists`);
    }
    try {
      await acquire.call(entry.provider, providerRef);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`[plugin:${entry.pluginId}] monitor artist failed: ${msg}`);
    }
    // The artist just became monitored — a stale 60s cache here would show
    // an un-monitored chip/badge on the very next view the user opens.
    this.monitoredCache = null;
  }

  /** Monitor an entire artist by NAME (e.g. from the External Artist view,
   *  which only knows the name): search the external sources, prefer a
   *  case-insensitive exact name match (else the first result), and route to
   *  its provider's acquireArtist. */
  async acquireArtistByName(name: string): Promise<void> {
    const results = await this.searchExternalArtists(name);
    const lower = name.toLowerCase();
    const match = results.find((r) => r.name.toLowerCase() === lower) ?? results[0];
    if (match === undefined) throw new Error("No acquisition source knows this artist");
    await this.acquireArtist(match.providerId, match.providerRef);
  }

  /** Fan out to EVERY acquisition provider for Downloads-view status rows,
   *  isolating throwing/slow providers; merge, tagging each row's pluginId. */
  async acquisitionStatus(): Promise<(AcquisitionStatusItem & { providerId: string })[]> {
    const timeoutMs = this.deps.providerTimeoutMs ?? ACQUISITION_TIMEOUT_MS;
    const results = await Promise.all(
      this.registry.acquisitionProviders.map(async (p) => {
        try {
          const items = await withTimeout(p.provider.status(), timeoutMs);
          if (!Array.isArray(items)) return [];
          return items.map((item) => ({ ...item, providerId: p.pluginId }));
        } catch (err) {
          console.error(
            `[providers] ${p.pluginId} acquisition provider "${p.provider.id}" status failed:`,
            err,
          );
          return [];
        }
      }),
    );
    return results.flat();
  }

  // ── Taste expansion + new-release watching ────────────────────────────────

  /** What the expansion coordinator needs: a scored similar source and an
   *  acquisition provider. */
  expansionCapabilities(): { similar: boolean; acquisition: boolean } {
    return {
      similar: this.registry.similarProviders.some((p) => p.provider.similarArtists !== undefined),
      acquisition: this.registry.acquisitionProviders.length > 0,
    };
  }

  /** Raw similar-artist list (with match scores) from the FIRST provider
   *  implementing it — expansion needs one coherent scoring source, not the
   *  merged/deduped panel view. [] on failure/none. */
  async similarArtistsScored(artistName: string): Promise<SimilarItem[]> {
    const timeoutMs = this.deps.providerTimeoutMs ?? PROVIDER_TIMEOUT_MS;
    for (const p of this.registry.similarProviders) {
      if (p.provider.similarArtists === undefined) continue;
      try {
        const items = await withTimeout(p.provider.similarArtists(artistName), timeoutMs);
        if (Array.isArray(items) && items.length > 0) return items;
      } catch (err) {
        console.error(`[providers] ${p.pluginId} similarArtists failed for expansion:`, err);
      }
    }
    return [];
  }

  /** An artist's most popular albums (best first) from the first provider
   *  implementing topAlbums. [] on failure/none. */
  async topAlbums(artistName: string): Promise<{ title: string }[]> {
    const timeoutMs = this.deps.providerTimeoutMs ?? PROVIDER_TIMEOUT_MS;
    for (const p of this.registry.similarProviders) {
      if (p.provider.topAlbums === undefined) continue;
      try {
        const items = await withTimeout(p.provider.topAlbums(artistName), timeoutMs);
        if (Array.isArray(items)) {
          return items.filter((a) => typeof a?.title === "string" && a.title.length > 0);
        }
      } catch (err) {
        console.error(`[providers] ${p.pluginId} topAlbums failed:`, err);
      }
    }
    return [];
  }

  /** Unmonitor a previously acquired album (abandon / "Not for me"). Routed
   *  to the provider that took the acquire; no-op if it can't cancel. */
  async cancelAlbum(providerId: string, providerRef: string): Promise<void> {
    const entry = this.registry.acquisitionProviders.find((p) => p.pluginId === providerId);
    const cancel = entry?.provider.cancelAlbum;
    if (entry === undefined || cancel === undefined) return;
    try {
      await cancel.call(entry.provider, providerRef);
    } catch (err) {
      console.error(`[providers] ${entry.pluginId} cancelAlbum failed:`, err);
    }
  }

  /** Per-artist "fetch new releases" watch — first provider implementing it. */
  async watchNewReleases(artistName: string, enabled: boolean): Promise<void> {
    for (const p of this.registry.acquisitionProviders) {
      const watch = p.provider.watchNewReleases;
      if (watch === undefined) continue;
      try {
        await watch.call(p.provider, artistName, enabled);
        return;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`[plugin:${p.pluginId}] watch failed: ${msg}`);
      }
    }
    throw new Error("No acquisition provider supports new-release watching");
  }

  /** null = no provider supports watching (renderer hides the toggle). */
  async isWatchingNewReleases(artistName: string): Promise<boolean | null> {
    const timeoutMs = this.deps.providerTimeoutMs ?? ACQUISITION_TIMEOUT_MS;
    for (const p of this.registry.acquisitionProviders) {
      const probe = p.provider.isWatchingNewReleases;
      if (probe === undefined) continue;
      try {
        return await withTimeout(probe.call(p.provider, artistName), timeoutMs);
      } catch (err) {
        console.error(`[providers] ${p.pluginId} isWatchingNewReleases failed:`, err);
        return null;
      }
    }
    return null;
  }

  async listWatchedArtists(): Promise<string[]> {
    const timeoutMs = this.deps.providerTimeoutMs ?? ACQUISITION_TIMEOUT_MS;
    for (const p of this.registry.acquisitionProviders) {
      const list = p.provider.listWatchedArtists;
      if (list === undefined) continue;
      try {
        const names = await withTimeout(list.call(p.provider), timeoutMs);
        if (Array.isArray(names)) {
          return names.filter((n): n is string => typeof n === "string" && n.length > 0);
        }
      } catch (err) {
        console.error(`[providers] ${p.pluginId} listWatchedArtists failed:`, err);
      }
    }
    return [];
  }

  /** Artist bio/stats — first similar provider with a non-null answer. */
  async artistInfo(artistName: string): Promise<ArtistInfo | null> {
    const timeoutMs = this.deps.providerTimeoutMs ?? PROVIDER_TIMEOUT_MS;
    for (const p of this.registry.similarProviders) {
      if (p.provider.artistInfo === undefined) continue;
      try {
        const info = await withTimeout(p.provider.artistInfo(artistName), timeoutMs);
        if (info && typeof info.name === "string") return info;
      } catch (err) {
        console.error(`[providers] ${p.pluginId} artistInfo failed:`, err);
      }
    }
    return null;
  }

  private monitoredCache: { at: number; names: string[] } | null = null;
  /** Union of monitored artists across providers; 60s cache — this backs
   *  tile badges, so it must be cheap to call repeatedly. */
  async listMonitoredArtists(): Promise<string[]> {
    if (this.monitoredCache && Date.now() - this.monitoredCache.at < 60_000) {
      return this.monitoredCache.names;
    }
    const timeoutMs = this.deps.providerTimeoutMs ?? ACQUISITION_TIMEOUT_MS;
    const names = new Set<string>();
    for (const p of this.registry.acquisitionProviders) {
      const list = p.provider.listMonitoredArtists;
      if (list === undefined) continue;
      try {
        const res = await withTimeout(list.call(p.provider), timeoutMs);
        for (const n of Array.isArray(res) ? res : []) {
          if (typeof n === "string" && n.length > 0) names.add(n);
        }
      } catch (err) {
        console.error(`[providers] ${p.pluginId} listMonitoredArtists failed:`, err);
      }
    }
    const out = [...names];
    this.monitoredCache = { at: Date.now(), names: out };
    return out;
  }

  /** "What's fetchable" (acquisition lookup) ∪ "what exists" (topAlbums) —
   *  lastfm-only titles appended as unavailable. */
  async externalDiscography(
    artistName: string,
  ): Promise<(AcquirableAlbum & { providerId: string })[]> {
    const [albums, known] = await Promise.all([
      this.lookupArtistAlbums(artistName),
      this.topAlbums(artistName),
    ]);
    // Cast to satisfy the AcquirableLike index signature — plugin-api types
    // don't carry [key: string]: unknown but mergeDiscography only reads the
    // declared fields; the cast is safe.
    const input = albums as unknown as Parameters<typeof mergeDiscography>[1];
    return mergeDiscography(artistName, input, known) as (AcquirableAlbum & {
      providerId: string;
    })[];
  }

  listTrackActions(): { pluginId: string; id: string; label: string; icon?: string }[] {
    return this.registry.trackActions.map((r) => ({
      pluginId: r.pluginId,
      id: r.action.id,
      label: r.action.label,
      ...(r.action.icon !== undefined ? { icon: r.action.icon } : {}),
    }));
  }

  /** Unknown action id → throw; a throwing action is rethrown with the plugin
   *  id prefixed so the renderer's error surface says who failed. */
  async invokeTrackAction(actionId: string, track: TrackInfo): Promise<void> {
    const entry = this.registry.trackActions.find((r) => r.action.id === actionId);
    if (!entry) throw new Error(`unknown track action "${actionId}"`);
    try {
      await entry.action.onInvoke(track);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`[plugin:${entry.pluginId}] track action "${actionId}" failed: ${msg}`);
    }
  }

  /** Fan out to every track-detail provider; failures/timeouts are logged and
   *  skipped, and providers returning null (no data) are dropped. */
  async getTrackDetails(
    track: TrackInfo,
  ): Promise<{ pluginId: string; title: string; rows: { label: string; value: string }[] }[]> {
    const timeoutMs = this.deps.providerTimeoutMs ?? PROVIDER_TIMEOUT_MS;
    const results = await Promise.all(
      this.registry.trackDetailProviders.map(async (p) => {
        try {
          const detail = await withTimeout(p.provider.getDetail(track), timeoutMs);
          return detail === null ? null : { pluginId: p.pluginId, ...detail };
        } catch (err) {
          console.error(
            `[providers] ${p.pluginId} track-detail provider "${p.provider.id}" failed:`,
            err,
          );
          return null;
        }
      }),
    );
    return results.filter((r) => r !== null);
  }
}
