import { Platform, useWindowDimensions } from "react-native";
import { deriveLayoutMode, type LayoutMode } from "./layout-mode";

/**
 * All iPad-layout branching keys off this one hook. Pad detection signal:
 * `Platform.OS === "ios" && Platform.isPad` (the discriminated Platform union
 * narrows to PlatformIOSStatic, which carries `isPad`). Lives apart from the
 * pure derivation because react-native cannot load under vitest.
 */
export function useLayoutMode(): LayoutMode {
  const { width, height } = useWindowDimensions();
  const isPad = Platform.OS === "ios" && Platform.isPad === true;
  return deriveLayoutMode({ width, height, isPad });
}
