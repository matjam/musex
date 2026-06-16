import type { Album } from "@musex/core";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, View } from "react-native";
import { artUrl } from "../../../src/logic/art-url";
import { useStore } from "../../../src/state/store";
import { AlbumArt } from "../../../src/ui/AlbumArt";
import { theme } from "../../../src/ui/theme";

export default function Albums() {
  const { artistId } = useLocalSearchParams<{ artistId: string }>();
  const { state, gateway, artBaseFor, token } = useStore();
  const router = useRouter();
  const [albums, setAlbums] = useState<Album[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!state.library || !state.token || !artistId) return;
      const list = await gateway.listAlbums(state.library, artistId, state.token);
      if (alive) {
        setAlbums(list);
        setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [state.library, state.token, artistId, gateway]);

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: "center", backgroundColor: theme.bg }}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }

  return (
    <FlatList
      style={{ backgroundColor: theme.bg }}
      contentContainerStyle={{ padding: theme.space(1) }}
      data={albums}
      keyExtractor={(a) => a.id}
      numColumns={2}
      renderItem={({ item }) => {
        const base = artBaseFor(item.serverId);
        const url = base && token ? artUrl(base, item.thumb, token) : null;
        return (
          <Pressable
            onPress={() =>
              router.push({ pathname: "/(tabs)/library/tracks", params: { albumId: item.id } })
            }
            style={{ flex: 1, padding: theme.space(1), maxWidth: "50%" }}
          >
            <AlbumArt url={url} size={170} />
            <Text numberOfLines={1} style={{ color: theme.text, fontSize: 14, marginTop: 6 }}>
              {item.title}
            </Text>
            {item.year ? (
              <Text style={{ color: theme.textDim, fontSize: 12 }}>{item.year}</Text>
            ) : null}
          </Pressable>
        );
      }}
    />
  );
}
