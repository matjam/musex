/** Pure decision for the auto keep-awake-while-syncing lock.
 *
 *  Why: the initial sync of a large library (~9k tracks) needs hours of
 *  continuous transfer, and iOS only guarantees foreground-created URLSession
 *  tasks — background refills are forced discretionary and defer arbitrarily,
 *  even on power (see BackgroundDownloadManager's taskWindow comment). Keeping
 *  the screen awake while musex is open on the charger keeps the app
 *  foreground, so the whole backlog drains without the user re-foregrounding
 *  every ~window tracks — charger-with-app-open is fully automatic.
 *
 *  Kept dependency-free (no expo imports) so it runs under vitest; the store
 *  maps AppState / the download index / expo-battery onto these booleans.
 */

/** expo-keep-awake tag for the sync lock (activate/deactivate must pair). */
export const SYNC_KEEP_AWAKE_TAG = "musex-sync";

export interface KeepAwakeConditions {
  /** App is in the foreground (AppState "active"). */
  foreground: boolean;
  /** Any download record is in flight (queued or downloading). */
  inFlight: boolean;
  /** Device is on power (battery charging or full). */
  charging: boolean;
}

/** Keep the screen awake only while ALL conditions hold; the moment any one
 *  drops (backgrounded, sync drained, charger unplugged) the lock releases. */
export function shouldKeepAwake(c: KeepAwakeConditions): boolean {
  return c.foreground && c.inFlight && c.charging;
}
