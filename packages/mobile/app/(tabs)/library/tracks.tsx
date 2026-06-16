import type { Track } from "@musex/core";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, View } from "react-native";
import { artUrl } from "../../../src/logic/art-url";
import { useStore } from "../../../src/state/store";
import { ActionBar } from "../../../src/ui/ActionBar";
import { AlbumArt } from "../../../src/ui/AlbumArt";
import { theme } from "../../../src/ui/theme";

export default function AlbumTracks() {
  const { albumId } = useLocalSearchParams<{ albumId: string }>();
  const { state, gateway, session, playTracks, artBaseFor, token } = useStore();
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!state.library || !state.token || !albumId) return;
      const list = await gateway.listTracks(state.library, albumId, state.token);
      if (alive) {
        setTracks(list);
        setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [state.library, state.token, albumId, gateway]);

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
          <ActionBar session={session} getTracks={() => tracks} />
        </View>
      }
      renderItem={({ item, index }) => (
        <Pressable
          onPress={() => void playTracks(tracks, index)}
          style={{
            flexDirection: "row",
            gap: 12,
            padding: theme.space(1.5),
            borderBottomWidth: 1,
            borderBottomColor: theme.border,
          }}
        >
          <Text style={{ color: theme.textDim, width: 22, textAlign: "right" }}>
            {item.trackNumber ?? index + 1}
          </Text>
          <Text style={{ color: theme.text, fontSize: 16, flex: 1 }} numberOfLines={1}>
            {item.title}
          </Text>
        </Pressable>
      )}
    />
  );
}
