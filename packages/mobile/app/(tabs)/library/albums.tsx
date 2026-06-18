import type { Album, Artist } from "@musex/core";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Text, useWindowDimensions, View } from "react-native";
import { artUrl } from "../../../src/logic/art-url";
import { useStore } from "../../../src/state/store";
import { ActionBar } from "../../../src/ui/ActionBar";
import { AlbumArt } from "../../../src/ui/AlbumArt";
import { Tile } from "../../../src/ui/Tile";
import { theme } from "../../../src/ui/theme";

export default function ArtistAlbums() {
  const { artistId } = useLocalSearchParams<{ artistId: string }>();
  const { state, gateway, session, artBaseFor, token, taste } = useStore();
  const router = useRouter();
  const navigation = useNavigation();
  const { width } = useWindowDimensions();
  const [albums, setAlbums] = useState<Album[]>([]);
  const [artist, setArtist] = useState<Artist | null>(null);
  const [loading, setLoading] = useState(true);
  const tileSize = (width - 8) / 2;

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!state.library || !state.token || !artistId) return;
      const [albumList, artistInfo] = await Promise.all([
        gateway.listAlbums(state.library, artistId, state.token),
        gateway.getArtist(state.library, artistId, state.token),
      ]);
      if (alive) {
        setAlbums(albumList);
        setArtist(artistInfo);
        setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [state.library, state.token, artistId, gateway]);

  // Update the screen title once we know the artist name.
  useEffect(() => {
    if (artist?.name) {
      navigation.setOptions({ title: artist.name });
    }
  }, [artist, navigation]);

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: "center", backgroundColor: theme.bg }}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }

  const base = artist ? artBaseFor(artist.serverId) : null;
  const artistArt = base && token && artist?.thumb ? artUrl(base, artist.thumb, token) : null;

  // Pull play stats for this artist from the local taste profile.
  const snap = taste.snapshot();
  const artistStat = artist
    ? snap.topArtists.find((a) => a.name.toLowerCase() === artist.name.toLowerCase())
    : undefined;

  const ArtistHeader = artist ? (
    <View
      style={{
        paddingHorizontal: theme.space(2),
        paddingTop: theme.space(2),
        paddingBottom: theme.space(1),
        flexDirection: "row",
        alignItems: "center",
        gap: 16,
      }}
    >
      <AlbumArt url={artistArt} size={80} circular />
      <View style={{ flex: 1 }}>
        <Text
          style={{
            color: theme.text,
            fontSize: 22,
            fontWeight: "700",
          }}
          numberOfLines={2}
        >
          {artist.name}
        </Text>
        {artist.genres && artist.genres.length > 0 ? (
          <Text style={{ color: theme.textDim, fontSize: 12, marginTop: 3 }} numberOfLines={1}>
            {artist.genres.slice(0, 3).join(" · ")}
          </Text>
        ) : null}
        {artistStat ? (
          <Text style={{ color: theme.textDim, fontSize: 12, marginTop: 2 }}>
            {`Score: ${Math.round(artistStat.score * 100) / 100}`}
          </Text>
        ) : null}
      </View>
    </View>
  ) : null;

  return (
    <FlatList
      style={{ backgroundColor: theme.bg }}
      data={albums}
      numColumns={2}
      keyExtractor={(a) => a.id}
      ListHeaderComponent={
        <View>
          {ArtistHeader}
          <ActionBar
            session={session}
            getTracks={() =>
              state.library && state.token && artistId
                ? gateway.listArtistTracks(artistId, state.library, state.token)
                : []
            }
          />
        </View>
      }
      renderItem={({ item }) => {
        const albumBase = artBaseFor(item.serverId);
        const art = albumBase && token ? artUrl(albumBase, item.thumb, token) : null;
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
