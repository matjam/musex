import { buildQueue, type PlaybackSession, type Track } from "@musex/core";
import { EllipsisVertical } from "lucide-react-native";
import { useState } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import { artUrl } from "../logic/art-url";
import { ActionBar } from "./ActionBar";
import { AlbumArt } from "./AlbumArt";
import { TrackActionSheet } from "./TrackActionSheet";
import { theme } from "./theme";

export function TrackList({
  title,
  tracks,
  session,
  artBaseFor,
  token,
  playlistId,
  playlistItemIds,
  onTracksChanged,
  headerExtra,
}: {
  title: string;
  tracks: Track[];
  session: PlaybackSession;
  artBaseFor: (serverId: string) => string | null;
  token: string | null;
  /** Present when rendering a playlist — enables "Remove from this playlist". */
  playlistId?: string;
  /** Parallel to `tracks`: `playlistItemIds[i]` is the Plex playlistItemID for row `i`. */
  playlistItemIds?: string[];
  /** Called after a successful track removal so the parent can refetch. */
  onTracksChanged?: () => void;
  /** Rendered directly under the ActionBar (e.g. a download progress bar). */
  headerExtra?: React.ReactNode;
}) {
  const [sheetTrack, setSheetTrack] = useState<Track | null>(null);
  const [sheetIndex, setSheetIndex] = useState<number | null>(null);

  const openSheet = (item: Track, index: number) => {
    setSheetTrack(item);
    setSheetIndex(index);
  };

  const closeSheet = () => {
    setSheetTrack(null);
    setSheetIndex(null);
  };

  const playlistItemId =
    sheetIndex !== null ? (playlistItemIds?.[sheetIndex] ?? undefined) : undefined;
  const resolvedPlaylistContext =
    playlistId && playlistItemId ? { playlistId, playlistItemId } : undefined;

  return (
    <>
      <FlatList
        style={{ flex: 1, backgroundColor: theme.bg }}
        data={tracks}
        keyExtractor={(t, i) => `${t.id}-${i}`}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View>
            <Text
              style={{
                color: theme.text,
                fontSize: 22,
                fontWeight: "700",
                paddingHorizontal: theme.space(2),
                paddingTop: theme.space(2),
                paddingBottom: theme.space(1),
              }}
            >
              {title}
            </Text>
            <ActionBar session={session} getTracks={() => tracks} />
            {headerExtra}
          </View>
        }
        renderItem={({ item, index }) => {
          const base = artBaseFor(item.serverId);
          const art = base && token ? artUrl(base, item.thumb, token) : null;
          const sub = [item.albumTitle, item.artistName].filter(Boolean).join(" · ");
          return (
            <Pressable
              onPress={() => void session.loadQueue(buildQueue(tracks, index))}
              onLongPress={() => openSheet(item, index)}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                paddingHorizontal: theme.space(2),
                paddingVertical: theme.space(1),
                borderBottomWidth: 1,
                borderBottomColor: theme.border,
              }}
            >
              <AlbumArt url={art} size={48} />
              <View style={{ flex: 1 }}>
                <Text numberOfLines={1} style={{ color: theme.text, fontSize: 15 }}>
                  {item.title}
                </Text>
                {sub ? (
                  <Text numberOfLines={1} style={{ color: theme.textDim, fontSize: 12 }}>
                    {sub}
                  </Text>
                ) : null}
              </View>
              <Pressable hitSlop={8} onPress={() => openSheet(item, index)} style={{ padding: 6 }}>
                <EllipsisVertical color={theme.textDim} size={20} />
              </Pressable>
            </Pressable>
          );
        }}
      />
      <TrackActionSheet
        track={sheetTrack}
        visible={sheetTrack !== null}
        onClose={closeSheet}
        playlistContext={resolvedPlaylistContext}
        onRemovedFromPlaylist={resolvedPlaylistContext ? onTracksChanged : undefined}
      />
    </>
  );
}
