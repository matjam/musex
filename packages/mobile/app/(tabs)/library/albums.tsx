import type { Album, Artist } from "@musex/core";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { Radio } from "lucide-react-native";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import type { ArtistInfo } from "../../../src/lastfm/lastfm-service";
import { artUrl } from "../../../src/logic/art-url";
import { useStore } from "../../../src/state/store";
import { ActionBar } from "../../../src/ui/ActionBar";
import { AlbumArt } from "../../../src/ui/AlbumArt";
import { Tile } from "../../../src/ui/Tile";
import { theme } from "../../../src/ui/theme";

/** Resolved similar artist: owned = navigate on press, unowned = dimmed. */
interface SimilarArtistItem {
  name: string;
  artistId: string | null;
  serverId: string | null;
  thumb: string | null;
}

export default function ArtistAlbums() {
  const { artistId } = useLocalSearchParams<{ artistId: string }>();
  const { state, gateway, session, artBaseFor, token, taste, lastfm, startRadio } = useStore();
  const router = useRouter();
  const navigation = useNavigation();
  const { width } = useWindowDimensions();
  const [albums, setAlbums] = useState<Album[]>([]);
  const [artist, setArtist] = useState<Artist | null>(null);
  const [loading, setLoading] = useState(true);
  const [similar, setSimilar] = useState<SimilarArtistItem[]>([]);
  const [bio, setBio] = useState<ArtistInfo | null>(null);
  const [bioExpanded, setBioExpanded] = useState(false);
  const tileSize = (width - 8) / 2;
  const similarTileSize = 80;

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!state.library || !state.token || !artistId) return;
      const [albumList, artistInfo] = await Promise.all([
        gateway.listAlbums(state.library, artistId, state.token),
        gateway.getArtist(state.library, artistId, state.token),
      ]);
      if (!alive) return;
      setAlbums(albumList);
      setArtist(artistInfo);
      setLoading(false);

      if (!artistInfo) return;

      // Fetch last.fm similar artists + bio in parallel (no-op when not configured).
      const [similarNames, artistBio] = await Promise.all([
        lastfm.similarArtists(artistInfo.name, 12),
        lastfm.artistInfo(artistInfo.name),
      ]);
      if (!alive) return;
      setBio(artistBio);

      if (similarNames.length > 0 && state.library && state.token) {
        // Resolve owned status: search the library for each similar name.
        const resolved: SimilarArtistItem[] = [];
        for (const name of similarNames) {
          try {
            const results = await gateway.search(state.library, name, state.token);
            const match = results.artists.find((a) => a.name.toLowerCase() === name.toLowerCase());
            if (alive) {
              resolved.push({
                name,
                artistId: match?.id ?? null,
                serverId: match?.serverId ?? null,
                thumb: match?.thumb ?? null,
              });
            }
          } catch {
            if (alive) resolved.push({ name, artistId: null, serverId: null, thumb: null });
          }
        }
        if (alive) setSimilar(resolved);
      }
    })();
    return () => {
      alive = false;
    };
  }, [state.library, state.token, artistId, gateway, lastfm]);

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
        <Pressable
          onPress={() => startRadio({ artist: artist.name, label: artist.name })}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 5,
            marginTop: 6,
            alignSelf: "flex-start",
          }}
        >
          <Radio color={theme.accent} size={14} />
          <Text style={{ color: theme.accent, fontSize: 13 }}>Radio</Text>
        </Pressable>
      </View>
    </View>
  ) : null;

  // Similar artists rail (rendered in header below ArtistHeader + ActionBar).
  const SimilarRail =
    similar.length > 0 ? (
      <View style={{ paddingTop: theme.space(1) }}>
        <Text
          style={{
            color: theme.textDim,
            fontSize: 12,
            textTransform: "uppercase",
            paddingHorizontal: theme.space(2),
            paddingBottom: 6,
          }}
        >
          Similar Artists
        </Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: theme.space(2), gap: 12 }}
        >
          {similar.map((s) => {
            const sBase = s.serverId ? artBaseFor(s.serverId) : null;
            const sArt = sBase && token && s.thumb ? artUrl(sBase, s.thumb, token) : null;
            const content = (
              <View style={{ alignItems: "center", width: similarTileSize }}>
                <AlbumArt url={sArt} size={similarTileSize} circular />
                <Text
                  style={{
                    color: s.artistId ? theme.text : theme.textDim,
                    fontSize: 11,
                    marginTop: 4,
                    textAlign: "center",
                  }}
                  numberOfLines={2}
                >
                  {s.name}
                </Text>
              </View>
            );
            if (s.artistId) {
              return (
                <Pressable
                  key={s.name}
                  onPress={() =>
                    router.push({
                      pathname: "/(tabs)/library/albums",
                      params: { artistId: s.artistId! },
                    })
                  }
                >
                  {content}
                </Pressable>
              );
            }
            return <View key={s.name}>{content}</View>;
          })}
        </ScrollView>
      </View>
    ) : null;

  // About / bio section (ListFooterComponent).
  const AboutFooter = bio?.bio ? (
    <View style={{ padding: theme.space(2), paddingTop: theme.space(1) }}>
      <Text
        style={{
          color: theme.textDim,
          fontSize: 12,
          textTransform: "uppercase",
          paddingBottom: 6,
        }}
      >
        About
      </Text>
      <Text
        style={{ color: theme.text, fontSize: 14, lineHeight: 20 }}
        numberOfLines={bioExpanded ? undefined : 3}
      >
        {bio.bio}
      </Text>
      <Pressable onPress={() => setBioExpanded((v) => !v)} style={{ marginTop: 4 }}>
        <Text style={{ color: theme.accent, fontSize: 13 }}>{bioExpanded ? "Less" : "More"}</Text>
      </Pressable>
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
          {SimilarRail}
        </View>
      }
      ListFooterComponent={AboutFooter}
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
