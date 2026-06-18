/**
 * Shared, quickjs-free types for the plugin host. Kept in their own module so
 * the package ROOT export (`./index.ts`) can re-export them without pulling in
 * `quickjs-emscripten` — only the `/sandbox` subpath depends on quickjs.
 */

/**
 * Snapshot of what a guest plugin registered during activate(). Built by the
 * sandbox (from the guest registry) and consumed transport-agnostically by
 * `registerHubProxies` to wire provider proxies into a ProviderHub.
 */
export interface BridgeRegState {
  acquisition: boolean;
  /** Optional methods defined on the acquisition provider (e.g. "acquireArtist", "searchArtists"). */
  acquisitionMethods: string[];
  recommender: boolean;
  settingsActions: string[];
  similar: string[];
  /** Map from section provider id → target ("discover" | "home") */
  sections: Record<string, string>;
  trackActions: string[];
  /** Metadata (label + optional icon) per track action id, read from the guest
   *  registry. Carried in the snapshot so proxies can be built synchronously
   *  without a second guest round-trip. */
  trackActionMeta: Record<string, { label: string; icon?: string }>;
  trackDetail: string[];
  eventHandlers: string[];
}
