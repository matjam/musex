import type { ContainerDownloadProgress } from "@musex/core";
import { formatBytes } from "@musex/core";
import { Text, View } from "react-native";
import { theme } from "./theme";

/** Thin per-container download progress bar with a "{done}/{total} tracks ·
 *  bytes" caption. Renders ONLY while something is actively downloading —
 *  "partial" (some tracks failed, nothing in flight) would otherwise leave
 *  the bar lingering forever. */
export function DownloadProgressBar({ progress }: { progress: ContainerDownloadProgress }) {
  if (progress.state !== "downloading") return null;
  const fraction = Math.min(1, Math.max(0, progress.fraction ?? 0));
  return (
    <View style={{ paddingHorizontal: theme.space(2), paddingVertical: theme.space(1) }}>
      <View
        style={{ height: 3, borderRadius: 2, backgroundColor: theme.border, overflow: "hidden" }}
      >
        <View style={{ height: 3, width: `${fraction * 100}%`, backgroundColor: theme.accent }} />
      </View>
      <Text style={{ color: theme.textDim, fontSize: 11, marginTop: 4 }}>
        {`${progress.done}/${progress.total} tracks · ${formatBytes(progress.bytes)}${
          progress.expectedBytes !== null ? ` of ${formatBytes(progress.expectedBytes)}` : ""
        }`}
      </Text>
    </View>
  );
}
