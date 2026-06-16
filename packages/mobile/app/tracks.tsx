import type { Track } from "@musex/core";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, View } from "react-native";
import { useStore } from "../src/state/store";
import { Row } from "../src/ui/Row";
import { theme } from "../src/ui/theme";

export default function Tracks() {
  const { albumId } = useLocalSearchParams<{ albumId: string }>();
  const { state, gateway, playTracks } = useStore();
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

  return (
    <FlatList
      style={{ backgroundColor: theme.bg }}
      data={tracks}
      keyExtractor={(t) => t.id}
      renderItem={({ item, index }) => (
        <Row
          title={`${item.trackNumber ? `${item.trackNumber}. ` : ""}${item.title}`}
          subtitle={item.artistName}
          onPress={() => void playTracks(tracks, index)}
        />
      )}
    />
  );
}
