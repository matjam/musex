import ExpoModulesCore
import UIKit

// Relaunch wiring: when our background URLSession has events for a suspended
// or killed app, iOS calls this and we must (1) recreate the session so the
// delegate can keep chaining/refilling and (2) hold the completion handler
// until the session reports its queued events are drained
// (urlSessionDidFinishEvents → manager calls it on the main queue).
public final class BackgroundDownloadsAppDelegateSubscriber: ExpoAppDelegateSubscriber {
  public func application(
    _ application: UIApplication,
    handleEventsForBackgroundURLSession identifier: String,
    completionHandler: @escaping () -> Void
  ) {
    guard identifier == BackgroundDownloadManager.sessionIdentifier else {
      // Not our session: call the handler at once — the ExpoAppDelegate
      // aggregates handlers across ALL subscribers and only fires the system
      // one when every subscriber has called back.
      completionHandler()
      return
    }
    BackgroundDownloadManager.shared.setBackgroundCompletionHandler(completionHandler)
    BackgroundDownloadManager.shared.ensureStarted()
  }
}
