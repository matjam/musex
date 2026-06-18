/** A validator-keyed cache for item-heavy list results. Storage is platform
 *  (fs on desktop, expo-file-system on mobile) behind this port; `@musex/core`
 *  stays pure. A `get` returns data only when the stored validator matches;
 *  `getStale` returns data ignoring the validator (offline-serve). */
export interface ListCache {
  init(): Promise<void>;
  /** Cached data iff stored AND its validator matches; else null. */
  get<T>(key: string, validator: string): Promise<T | null>;
  /** Cached data ignoring the validator (offline-serve); null if absent. */
  getStale<T>(key: string): Promise<T | null>;
  set<T>(key: string, validator: string, data: T): Promise<void>;
  evictKey(key: string): Promise<void>;
  clear(): Promise<void>;
}
