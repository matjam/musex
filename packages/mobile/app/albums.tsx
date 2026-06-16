import type { Album } from "@musex/core";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, View } from "react-native";
import { useStore } from "../src/state/store";
import { Row } from "../src/ui/Row";
import { theme } from "../src/ui/theme";

export default function Albums() {
  const { artistId } = useLocalSearchParams<{ artistId: string }>();
  const { state, gateway } = useStore();
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
      data={albums}
      keyExtractor={(a) => a.id}
      renderItem={({ item }) => (
        <Row
          title={item.title}
          subtitle={item.year ? String(item.year) : undefined}
          onPress={() => router.push({ pathname: "/tracks", params: { albumId: item.id } })}
        />
      )}
    />
  );
}
