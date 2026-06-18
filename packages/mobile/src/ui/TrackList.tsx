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
}: {
  title: string;
  tracks: Track[];
  session: PlaybackSession;
  artBaseFor: (serverId: string) => string | null;
  token: string | null;
}) {
  const [sheetTrack, setSheetTrack] = useState<Track | null>(null);
  return (
    <>
      <FlatList
        style={{ flex: 1, backgroundColor: theme.bg }}
        data={tracks}
        keyExtractor={(t, i) => `${t.id}-${i}`}
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
          </View>
        }
        renderItem={({ item, index }) => {
          const base = artBaseFor(item.serverId);
          const art = base && token ? artUrl(base, item.thumb, token) : null;
          const sub = [item.albumTitle, item.artistName].filter(Boolean).join(" · ");
          return (
            <Pressable
              onPress={() => void session.loadQueue(buildQueue(tracks, index))}
              onLongPress={() => setSheetTrack(item)}
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
              <Pressable hitSlop={8} onPress={() => setSheetTrack(item)} style={{ padding: 6 }}>
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
