import { NativeModule, requireNativeModule } from "expo";

type LockScreenCommandsEvents = {
  onNext: () => void;
  onPrevious: () => void;
};

declare class LockScreenCommandsModule extends NativeModule<LockScreenCommandsEvents> {}

// requireNativeModule throws when the native module isn't built into the binary
// (Expo Go, unit tests, pre-prebuild). Swallow that so importing this module is
// always safe; consumers null-check the default export.
let native: LockScreenCommandsModule | null = null;
try {
  native = requireNativeModule<LockScreenCommandsModule>("LockScreenCommands");
} catch {
  native = null;
}

export default native;
