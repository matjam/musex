import type { Album } from "@musex/core";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, useWindowDimensions, View } from "react-native";
import { artUrl } from "../../../src/logic/art-url";
import { useStore } from "../../../src/state/store";
import { ActionBar } from "../../../src/ui/ActionBar";
import { Tile } from "../../../src/ui/Tile";
import { theme } from "../../../src/ui/theme";

export default function ArtistAlbums() {
  const { artistId } = useLocalSearchParams<{ artistId: string }>();
  const { state, gateway, session, artBaseFor, token } = useStore();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const [albums, setAlbums] = useState<Album[]>([]);
  const [loading, setLoading] = useState(true);
  const tileSize = (width - 8) / 2;

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
      numColumns={2}
      keyExtractor={(a) => a.id}
      ListHeaderComponent={
        <ActionBar
          session={session}
          getTracks={() =>
            state.library && state.token && artistId
              ? gateway.listArtistTracks(artistId, state.library, state.token)
              : []
          }
        />
      }
      renderItem={({ item }) => {
        const base = artBaseFor(item.serverId);
        const art = base && token ? artUrl(base, item.thumb, token) : null;
        return (
          <Tile
            art={art}
            size={tileSize}
            label={item.title}
            sublabel={item.year ? String(item.year) : undefined}
            onPress={() =>
              router.push({ pathname: "/(tabs)/library/tracks", params: { albumId: item.id } })
            }
          />
        );
      }}
    />
  );
}
