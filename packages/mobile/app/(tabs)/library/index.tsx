import type { Artist } from "@musex/core";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, View } from "react-native";
import { artUrl } from "../../../src/logic/art-url";
import { useStore } from "../../../src/state/store";
import { AlbumArt } from "../../../src/ui/AlbumArt";
import { theme } from "../../../src/ui/theme";

export default function Artists() {
  const { state, gateway, artBaseFor, token } = useStore();
  const router = useRouter();
  const [artists, setArtists] = useState<Artist[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!state.library || !state.token) return;
      const list = await gateway.listArtists(state.library, state.token);
      if (alive) {
        setArtists(list);
        setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [state.library, state.token, gateway]);

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
      data={artists}
      keyExtractor={(a) => a.id}
      renderItem={({ item }) => {
        const base = artBaseFor(item.serverId);
        const url = base && token ? artUrl(base, item.thumb, token) : null;
        return (
          <Pressable
            onPress={() =>
              router.push({ pathname: "/(tabs)/library/albums", params: { artistId: item.id } })
            }
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 12,
              padding: theme.space(1.5),
              borderBottomWidth: 1,
              borderBottomColor: theme.border,
            }}
          >
            <AlbumArt url={url} size={44} circular />
            <Text style={{ color: theme.text, fontSize: 16 }}>{item.name}</Text>
          </Pressable>
        );
      }}
    />
  );
}
