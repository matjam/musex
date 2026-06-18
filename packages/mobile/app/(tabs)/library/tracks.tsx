import type { Track } from "@musex/core";
import { buildDownloadLookup, downloadRecordFor } from "@musex/core";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { EllipsisVertical } from "lucide-react-native";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, View } from "react-native";
import { artUrl } from "../../../src/logic/art-url";
import { useStore } from "../../../src/state/store";
import { ActionBar } from "../../../src/ui/ActionBar";
import { AlbumArt } from "../../../src/ui/AlbumArt";
import { TrackActionSheet } from "../../../src/ui/TrackActionSheet";
import { theme } from "../../../src/ui/theme";

export default function AlbumTracks() {
  const { albumId } = useLocalSearchParams<{ albumId: string }>();
  const { state, gateway, session, playTracks, artBaseFor, token, downloadsList, connectivity } =
    useStore();
  const offline = connectivity === "offline";
  const downloadLookup = useMemo(
    () => buildDownloadLookup(downloadsList()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [downloadsList],
  );
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);
  const [sheetTrack, setSheetTrack] = useState<Track | null>(null);

  // Refetch on focus so newly-added tracks appear when returning to this screen.
  // Skip the spinner when tracks are already loaded (background refresh, no flicker).
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        if (!state.library || !state.token || !albumId) return;
        if (tracks.length === 0) setLoading(true);
        try {
          const list = await gateway.listTracks(state.library, albumId, state.token);
          if (alive) {
            setTracks(list);
            setLoading(false);
          }
        } catch {
          // Non-fatal: keep existing tracks on a background-refresh failure.
          if (alive) setLoading(false);
        }
      })();
      return () => {
        alive = false;
      };
    }, [state.library, state.token, albumId, gateway, tracks.length]),
  );

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: "center", backgroundColor: theme.bg }}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }

  const first = tracks[0];
  const base = first ? artBaseFor(first.serverId) : null;
  const headerArt = first && base && token ? artUrl(base, first.thumb, token) : null;

  return (
    <>
      <FlatList
        style={{ backgroundColor: theme.bg }}
        data={tracks}
        keyExtractor={(t) => t.id}
        ListHeaderComponent={
          <View>
            <View style={{ alignItems: "center", paddingVertical: theme.space(2) }}>
              <AlbumArt url={headerArt} size={200} />
              {first?.albumTitle ? (
                <Text style={{ color: theme.text, fontSize: 18, fontWeight: "700", marginTop: 10 }}>
                  {first.albumTitle}
                </Text>
              ) : null}
              {first ? <Text style={{ color: theme.textDim }}>{first.artistName}</Text> : null}
            </View>
            <ActionBar
              session={session}
              getTracks={() =>
                offline ? tracks.filter((t) => !!downloadRecordFor(downloadLookup, t)) : tracks
              }
            />
          </View>
        }
        renderItem={({ item, index }) => {
          const isAvailable = !offline || !!downloadRecordFor(downloadLookup, item);
          return (
            <Pressable
              onPress={isAvailable ? () => void playTracks(tracks, index) : undefined}
              onLongPress={isAvailable ? () => setSheetTrack(item) : undefined}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                padding: theme.space(1.5),
                borderBottomWidth: 1,
                borderBottomColor: theme.border,
                opacity: isAvailable ? 1 : 0.35,
              }}
            >
              <Text style={{ color: theme.textDim, width: 22, textAlign: "right" }}>
                {item.trackNumber ?? index + 1}
              </Text>
              <Text style={{ color: theme.text, fontSize: 16, flex: 1 }} numberOfLines={1}>
                {item.title}
              </Text>
              <Pressable
                hitSlop={8}
                onPress={isAvailable ? () => setSheetTrack(item) : undefined}
                style={{ padding: 6 }}
              >
                <EllipsisVertical color={theme.textDim} size={20} />
              </Pressable>
            </Pressable>
          );
        }}
      />
      <TrackActionSheet
        track={sheetTrack}
        visible={sheetTrack !== null}
        onClose={() => setSheetTrack(null)}
      />
    </>
  );
}
