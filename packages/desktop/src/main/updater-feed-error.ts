/** True when an electron-updater check failed only because the release's update
 *  feed isn't available yet. release-please creates the GitHub release (and tag)
 *  before the build jobs upload its artifacts (`latest*.yml` + installers), so a
 *  check landing in that window — or one against a tag with no release at all —
 *  gets a 404. That's not a real error: there's simply no update to offer yet,
 *  so callers should behave as "up to date" rather than alarming the user. */
export function isUpdateFeedUnavailable(
  err: { message?: string; statusCode?: number; code?: number | string } | null | undefined,
): boolean {
  if (!err) return false;
  if (err.statusCode === 404 || err.code === 404) return true;
  const msg = err.message ?? "";
  // electron-updater's "Cannot find latest-mac.yml in the latest release
  // artifacts (…): HttpError: 404" — match the missing-feed text or the 404.
  return /\b404\b/.test(msg) || /cannot find .*\.ya?ml/i.test(msg);
}
