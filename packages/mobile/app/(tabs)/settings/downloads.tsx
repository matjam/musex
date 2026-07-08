import type { StorageQuality } from "@musex/core";
import { formatBytes, isInFlight, TRANSCODE_BITRATES } from "@musex/core";
import { useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, Switch, Text, View } from "react-native";
import { CACHE_CAP_OPTIONS } from "../../../src/downloads/cache-config";
import { useStore } from "../../../src/state/store";
import { useRecordsProgress } from "../../../src/state/use-download-progress";
import { DownloadProgressBar } from "../../../src/ui/DownloadProgressBar";
import { SegmentedControl } from "../../../src/ui/SegmentedControl";
import { theme } from "../../../src/ui/theme";

export default function DownloadsSettings() {
  const {
    getStorageQuality,
    setStorageQuality,
    downloadsList,
    removeDownload,
    totalDownloadBytes,
    syncEnabled,
    estimateSync,
    setSyncEnabled,
    cacheConfig,
    setCacheConfig,
    connectivity,
    downloadsVersion,
  } = useStore();

  const [syncBusy, setSyncBusy] = useState(false);

  // Active downloads: in-flight records (up to 20 shown) + a whole-collection
  // bar. Recompute as bytes land (downloadsVersion bumps on progress events).
  const wholeProgress = useRecordsProgress();
  // biome-ignore lint/correctness/useExhaustiveDependencies: downloadsVersion is a deliberate refresh trigger, not referenced in the body.
  const inFlight = useMemo(
    () => downloadsList().filter(isInFlight),
    [downloadsList, downloadsVersion],
  );

  // Failed downloads: count + the most frequent distinct error strings. This is
  // the on-device diagnostic for a failing sync (DownloadRecord.error holds the
  // exact failure, e.g. "http 401").
  // biome-ignore lint/correctness/useExhaustiveDependencies: downloadsVersion is a deliberate refresh trigger, not referenced in the body.
  const failedSummary = useMemo(() => {
    const failed = downloadsList().filter((r) => r.state === "failed");
    const counts = new Map<string, number>();
    for (const r of failed) {
      const err = r.error ?? "unknown error";
      counts.set(err, (counts.get(err) ?? 0) + 1);
    }
    const topErrors = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    return { count: failed.length, topErrors };
  }, [downloadsList, downloadsVersion]);

  function handleSyncToggle(next: boolean) {
    if (syncBusy) return;
    if (!next) {
      Alert.alert(
        "Turn off library sync",
        "This deletes all music downloaded by sync from this device. Tracks you pinned manually are kept.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Turn off & delete",
            style: "destructive",
            onPress: () => {
              setSyncBusy(true);
              void setSyncEnabled(false).finally(() => setSyncBusy(false));
            },
          },
        ],
      );
      return;
    }
    if (connectivity !== "online") {
      Alert.alert("You're offline", "Connect to the internet to start syncing your library.");
      return;
    }
    setSyncBusy(true);
    void estimateSync()
      .then((est) => {
        if (!est) {
          Alert.alert("Couldn't estimate", "Unable to read your library right now. Try again.");
          return;
        }
        if (est.bytes > est.freeBytes) {
          Alert.alert(
            "Not enough space",
            `Syncing your library needs about ${formatBytes(est.bytes)}, but only ${formatBytes(est.freeBytes)} is free. Free up space or switch to AAC at a lower bitrate.`,
          );
          return;
        }
        Alert.alert(
          "Sync entire library?",
          `Download ${est.trackCount} tracks (about ${formatBytes(est.bytes)}). ${formatBytes(est.freeBytes)} free. New music added to Plex will download automatically; music removed from Plex will be deleted here.`,
          [
            { text: "Cancel", style: "cancel" },
            {
              text: "Download",
              onPress: () => {
                setSyncBusy(true);
                void setSyncEnabled(true).finally(() => setSyncBusy(false));
              },
            },
          ],
        );
      })
      .finally(() => setSyncBusy(false));
  }

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
        Library Sync
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
          }}
        >
          <View style={{ flex: 1, paddingRight: theme.space(1.5) }}>
            <Text style={{ color: theme.text, fontSize: 15 }}>Sync entire library</Text>
            <Text style={{ color: theme.textDim, fontSize: 12, marginTop: 2 }}>
              Keep every track on this device, in sync with Plex.
            </Text>
          </View>
          {syncBusy ? (
            <ActivityIndicator color={theme.textDim} />
          ) : (
            <Switch value={syncEnabled} onValueChange={handleSyncToggle} />
          )}
        </View>
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
        Keep Played Tracks
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
        {/* While library sync is on, play-caching is redundant (every track is
            already kept offline) — grey the row out without touching the stored
            cacheConfig, so turning sync off reveals the previous setting. */}
        <View
          style={{ flexDirection: "row", alignItems: "center", opacity: syncEnabled ? 0.4 : 1 }}
        >
          <View style={{ flex: 1, paddingRight: theme.space(1.5) }}>
            <Text style={{ color: theme.text, fontSize: 15 }}>Keep played tracks offline</Text>
            <Text style={{ color: theme.textDim, fontSize: 12, marginTop: 2 }}>
              {syncEnabled
                ? "Covered by library sync — every track is already kept offline."
                : "Tracks you listen to are saved automatically, up to the limit below."}
            </Text>
          </View>
          <Switch
            value={cacheConfig.enabled}
            disabled={syncEnabled}
            onValueChange={(v) => void setCacheConfig({ ...cacheConfig, enabled: v })}
          />
        </View>
        {cacheConfig.enabled ? (
          <View style={{ marginTop: theme.space(1.5) }}>
            <Text style={{ color: theme.textDim, fontSize: 12, marginBottom: 6 }}>Cache limit</Text>
            <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
              {CACHE_CAP_OPTIONS.map((opt) => {
                const selected = cacheConfig.capBytes === opt.bytes;
                return (
                  <Pressable
                    key={opt.label}
                    onPress={() => void setCacheConfig({ ...cacheConfig, capBytes: opt.bytes })}
                    style={{
                      paddingVertical: 7,
                      paddingHorizontal: 12,
                      borderRadius: 6,
                      backgroundColor: selected ? theme.border : "transparent",
                      borderWidth: 1,
                      borderColor: theme.border,
                    }}
                  >
                    <Text style={{ color: selected ? theme.text : theme.textDim, fontSize: 13 }}>
                      {opt.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
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

      {inFlight.length > 0 ? (
        <>
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
            Active Downloads
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
            <DownloadProgressBar progress={wholeProgress} />
            {inFlight.slice(0, 20).map((r) => (
              <View
                key={r.key}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  paddingHorizontal: theme.space(2),
                  paddingVertical: theme.space(1),
                  borderTopWidth: 1,
                  borderTopColor: theme.border,
                  opacity: r.state === "queued" ? 0.5 : 1,
                }}
              >
                <Text style={{ color: theme.text, flex: 1, fontSize: 13 }} numberOfLines={1}>
                  {r.meta.title}
                </Text>
                <Text style={{ color: theme.textDim, fontSize: 12 }}>
                  {r.state === "queued" ? "queued" : formatBytes(r.bytes)}
                </Text>
              </View>
            ))}
            {inFlight.length > 20 ? (
              <Text
                style={{
                  color: theme.textDim,
                  fontSize: 12,
                  paddingHorizontal: theme.space(2),
                  paddingVertical: theme.space(1),
                  borderTopWidth: 1,
                  borderTopColor: theme.border,
                }}
              >
                and {inFlight.length - 20} more…
              </Text>
            ) : null}
          </View>
        </>
      ) : null}

      {failedSummary.count > 0 ? (
        <>
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
            Failed
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
              paddingHorizontal: theme.space(2),
              paddingVertical: theme.space(1.5),
            }}
          >
            <Text style={{ color: "#8b1a1a", fontSize: 15, fontWeight: "600" }}>
              {failedSummary.count.toLocaleString()} failed
            </Text>
            {failedSummary.topErrors.map(([err, n]) => (
              <Text
                key={err}
                style={{ color: theme.textDim, fontSize: 12, marginTop: 4 }}
                numberOfLines={1}
              >
                “{err}” ×{n.toLocaleString()}
              </Text>
            ))}
          </View>
        </>
      ) : null}

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
