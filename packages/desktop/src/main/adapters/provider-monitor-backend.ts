import type { MonitorBackend } from "@musex/core";

/**
 * The slice of the acquisition surface this backend needs. The desktop's
 * ProviderHub does NOT expose a single `AcquisitionProvider` object — it fans
 * out across every registered acquisition plugin via aggregate methods — so the
 * adapter depends on this minimal facade rather than the plugin-api
 * `AcquisitionProvider` interface directly. The Runtime supplies a facade backed
 * by the hub (present iff an acquisition plugin is installed); tests supply a fake.
 */
export interface AcquisitionFacade {
  /** Monitor an entire artist by name (acquire discography + monitor). */
  acquireArtistByName(name: string): Promise<void>;
  /** Toggle the "fetch future releases" watch for an artist. */
  watchNewReleases(name: string, enabled: boolean): Promise<void>;
  /** Names of artists currently monitored by the provider(s). */
  listMonitoredArtists(): Promise<string[]>;
  /** Names of artists watched for new releases. */
  listWatchedArtists(): Promise<string[]>;
}

const NO_PROVIDER = "no acquisition plugin installed";

/**
 * SP0 MonitorBackend over the acquisition provider facade. `follow` acquires +
 * monitors; `unfollow` only stops watching new releases (acquired media is
 * KEPT — full un-acquire / file deletion is intentionally not supported here);
 * `isFollowed`/`listFollowed` read the union of monitored ∪ watched artists.
 *
 * The provider getter returns null when no acquisition plugin is installed:
 * follow/unfollow throw a friendly error, the read paths degrade to false / [].
 */
export class ProviderMonitorBackend implements MonitorBackend {
  constructor(private readonly getProvider: () => AcquisitionFacade | null) {}

  async follow(artistName: string): Promise<void> {
    const provider = this.getProvider();
    if (!provider) throw new Error(NO_PROVIDER);
    await provider.acquireArtistByName(artistName);
  }

  async unfollow(artistName: string): Promise<void> {
    const provider = this.getProvider();
    if (!provider) throw new Error(NO_PROVIDER);
    // Stop watching for new releases. Deliberately does NOT un-acquire / delete
    // the already-acquired discography — the acquisition provider has no safe
    // "forget everything" primitive, and the user keeps what they pulled in.
    await provider.watchNewReleases(artistName, false);
  }

  async isFollowed(artistName: string): Promise<boolean> {
    const provider = this.getProvider();
    if (!provider) return false;
    const lower = artistName.toLowerCase();
    const names = await this.union(provider);
    return names.some((n) => n.toLowerCase() === lower);
  }

  async listFollowed(): Promise<string[]> {
    const provider = this.getProvider();
    if (!provider) return [];
    return this.union(provider);
  }

  /** Deduped union of monitored ∪ watched artist names (case-preserving;
   *  dedup is case-insensitive). */
  private async union(provider: AcquisitionFacade): Promise<string[]> {
    const [monitored, watched] = await Promise.all([
      provider.listMonitoredArtists(),
      provider.listWatchedArtists(),
    ]);
    const byLower = new Map<string, string>();
    for (const n of [...monitored, ...watched]) {
      const lower = n.toLowerCase();
      if (!byLower.has(lower)) byLower.set(lower, n);
    }
    return [...byLower.values()];
  }
}
