import ExpoModulesCore
import MediaPlayer

// Bridges iOS lock-screen / Control-Center NEXT and PREVIOUS track commands to
// JS. expo-audio owns play/pause/seek + now-playing metadata; this module only
// adds the two track commands (separate MPRemoteCommand objects, no conflict).
// Targets are added when JS starts observing and removed when it stops.
public class LockScreenCommandsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("LockScreenCommands")

    Events("onNext", "onPrevious")

    OnStartObserving {
      let center = MPRemoteCommandCenter.shared()
      center.nextTrackCommand.isEnabled = true
      center.nextTrackCommand.addTarget { [weak self] _ in
        self?.sendEvent("onNext", [:])
        return .success
      }
      center.previousTrackCommand.isEnabled = true
      center.previousTrackCommand.addTarget { [weak self] _ in
        self?.sendEvent("onPrevious", [:])
        return .success
      }
    }

    OnStopObserving {
      let center = MPRemoteCommandCenter.shared()
      center.nextTrackCommand.removeTarget(nil)
      center.previousTrackCommand.removeTarget(nil)
    }
  }
}
