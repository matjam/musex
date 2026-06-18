import type { StorageQuality } from "@musex/core";
import { formatBytes, TRANSCODE_BITRATES } from "@musex/core";
import { useState } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { useStore } from "../../../src/state/store";
import { SegmentedControl } from "../../../src/ui/SegmentedControl";
import { theme } from "../../../src/ui/theme";

export default function DownloadsSettings() {
  const {
    getStorageQuality,
    setStorageQuality,
    downloadsList,
    removeDownload,
    totalDownloadBytes,
  } = useStore();

  const current = getStorageQuality();
  const [mode, setMode] = useState<StorageQuality["mode"]>(current.mode);
  const [bitrate, setBitrate] = useState<number>(current.bitrateKbps);

  async function applyQuality(next: StorageQuality) {
    setMode(next.mode);
    setBitrate(next.bitrateKbps);
    await setStorageQuality(next).catch(() => {
      // revert on failure
      setMode(current.mode);
      setBitrate(current.bitrateKbps);
    });
  }

  function handleRemoveAll() {
    Alert.alert(
      "Remove all downloads",
      "This will delete all downloaded tracks from this device. Are you sure?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove all",
          style: "destructive",
          onPress: async () => {
            const keys = downloadsList().map((r) => r.key);
            await Promise.allSettled(keys.map((k) => removeDownload(k)));
          },
        },
      ],
    );
  }

  const totalBytes = totalDownloadBytes();

  return (
    <ScrollView style={{ flex: 1, backgroundColor: theme.bg }}>
      <Text
        style={{
          color: theme.textDim,
          fontSize: 12,
          textTransform: "uppercase",
          paddingHorizontal: theme.space(2),
          paddingTop: theme.space(2),
          paddingBottom: 6,
        }}
      >
        Storage Quality
      </Text>
      <View
        style={{
          backgroundColor: theme.surface,
          borderRadius: 10,
          marginHorizontal: theme.space(2),
          marginBottom: theme.space(2),
          borderWidth: 1,
          borderColor: theme.border,
          overflow: "hidden",
          padding: theme.space(1.5),
        }}
      >
        <SegmentedControl
          segments={["Original", "AAC"]}
          value={mode === "original" ? "Original" : "AAC"}
          onChange={(s) =>
            void applyQuality({ mode: s === "AAC" ? "aac" : "original", bitrateKbps: bitrate })
          }
        />
        {mode === "aac" ? (
          <View style={{ marginTop: theme.space(1.5) }}>
            <Text style={{ color: theme.textDim, fontSize: 12, marginBottom: 6 }}>
              Bitrate (kbps)
            </Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              {TRANSCODE_BITRATES.map((b) => (
                <Pressable
                  key={b}
                  onPress={() => void applyQuality({ mode: "aac", bitrateKbps: b })}
                  style={{
                    flex: 1,
                    alignItems: "center",
                    paddingVertical: 7,
                    borderRadius: 6,
                    backgroundColor: bitrate === b ? theme.border : "transparent",
                    borderWidth: 1,
                    borderColor: theme.border,
                  }}
                >
                  <Text style={{ color: bitrate === b ? theme.text : theme.textDim, fontSize: 13 }}>
                    {b}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Text style={{ color: theme.textDim, fontSize: 11, marginTop: 6 }}>
              Downloads are transcoded to AAC at the selected bitrate. Original files stream
              directly.
            </Text>
          </View>
        ) : null}
      </View>

      <Text
        style={{
          color: theme.textDim,
          fontSize: 12,
          textTransform: "uppercase",
          paddingHorizontal: theme.space(2),
          paddingTop: theme.space(1),
          paddingBottom: 6,
        }}
      >
        Storage
      </Text>
      <View
        style={{
          backgroundColor: theme.surface,
          borderRadius: 10,
          marginHorizontal: theme.space(2),
          marginBottom: theme.space(2),
          borderWidth: 1,
          borderColor: theme.border,
          overflow: "hidden",
        }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            paddingHorizontal: theme.space(2),
            paddingVertical: theme.space(1.5),
            borderBottomWidth: 1,
            borderBottomColor: theme.border,
          }}
        >
          <Text style={{ color: theme.text, flex: 1, fontSize: 15 }}>Downloads size</Text>
          <Text style={{ color: theme.textDim, fontSize: 14 }}>{formatBytes(totalBytes)}</Text>
        </View>
        <Pressable
          onPress={handleRemoveAll}
          style={{
            paddingHorizontal: theme.space(2),
            paddingVertical: theme.space(1.5),
          }}
        >
          <Text style={{ color: "#e5534b", fontSize: 15 }}>Remove all downloads</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}
