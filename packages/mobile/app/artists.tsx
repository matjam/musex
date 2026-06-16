import type { Artist } from "@musex/core";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, View } from "react-native";
import { useStore } from "../src/state/store";
import { Row } from "../src/ui/Row";
import { theme } from "../src/ui/theme";

export default function Artists() {
  const { state, gateway } = useStore();
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
      renderItem={({ item }) => (
        <Row
          title={item.name}
          onPress={() => router.push({ pathname: "/albums", params: { artistId: item.id } })}
        />
      )}
    />
  );
}
