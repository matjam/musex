import ExpoModulesCore
import UIKit

// JS-facing surface of the background download engine. Job/snapshot payloads
// cross the bridge as JSON strings (the JS wrapper stringifies/parses); events
// are plain dictionaries. The engine itself lives in BackgroundDownloadManager
// (a singleton, so the AppDelegate subscriber can reach it on background
// relaunch when this module may not exist yet).
public class BackgroundDownloadsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("BackgroundDownloads")

    Events("onProgress", "onComplete", "onError")

    OnCreate {
      BackgroundDownloadManager.shared.setEmitter { [weak self] name, body in
        self?.sendEvent(name, body)
      }
      BackgroundDownloadManager.shared.ensureStarted()
    }

    OnDestroy {
      BackgroundDownloadManager.shared.setEmitter(nil)
    }

    AsyncFunction("submit") { (jobsJson: String, promise: Promise) in
      BackgroundDownloadManager.shared.submit(jobsJson) { error in
        if let error = error {
          promise.reject(error)
        } else {
          promise.resolve()
        }
      }
    }

    AsyncFunction("cancel") { (keys: [String], promise: Promise) in
      BackgroundDownloadManager.shared.cancel(keys) {
        promise.resolve()
      }
    }

    AsyncFunction("reattach") { (promise: Promise) in
      BackgroundDownloadManager.shared.reattach { snapshotJson in
        promise.resolve(snapshotJson)
      }
    }

    // Whether iOS lets this app run in the background at all — with
    // Background App Refresh off, library sync can't trickle while the app
    // is backgrounded and the Settings UI warns. Main thread required
    // (UIApplication property; ExpoModulesCore's sync Function has no
    // runOnQueue, hence an AsyncFunction).
    AsyncFunction("getBackgroundRefreshStatus") { () -> String in
      switch UIApplication.shared.backgroundRefreshStatus {
      case .available: return "available"
      case .denied: return "denied"
      case .restricted: return "restricted"
      @unknown default: return "available"
      }
    }.runOnQueue(.main)
  }
}
