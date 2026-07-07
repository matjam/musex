import type { Album, Artist } from "@musex/core";
import { downloadProgress, listValidator, OfflineUnavailable } from "@musex/core";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { Radio } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
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
import { DownloadProgressBar } from "../../../src/ui/DownloadProgressBar";
import { Tile } from "../../../src/ui/Tile";
import { theme } from "../../../src/ui/theme";

/** Resolved similar artist — always owned (unowned are dropped). */
interface SimilarArtistItem {
  name: string;
  artistId: string;
  serverId: string;
  thumb: string | null;
  updatedAt?: number; // from the matched owned Plex artist, for real cache validation on drill-down
}

export default function ArtistAlbums() {
  const { artistId, updatedAt } = useLocalSearchParams<{ artistId: string; updatedAt?: string }>();
  const {
    state,
    gateway,
    session,
    artBaseFor,
    token,
    taste,
    lastfm,
    startRadio,
    downloadsList,
    downloadsVersion,
  } = useStore();
  const router = useRouter();
  const navigation = useNavigation();
  const { width } = useWindowDimensions();
  const [albums, setAlbums] = useState<Album[]>([]);
  const [artist, setArtist] = useState<Artist | null>(null);
  const [loading, setLoading] = useState(true);
  const [offlineEmpty, setOfflineEmpty] = useState(false);
  const [similar, setSimilar] = useState<SimilarArtistItem[]>([]);
  const [bio, setBio] = useState<ArtistInfo | null>(null);
  const [bioExpanded, setBioExpanded] = useState(false);
  const tileSize = (width - 8) / 2;
  const similarTileSize = 80;

  // This artist's download progress, keyed by its index records (the screen
  // never loads the artist's full track list, so the record set IS the
  // container: bar shows while any of this artist's tracks are in flight).
  // biome-ignore lint/correctness/useExhaustiveDependencies: downloadsVersion is a deliberate refresh trigger, not referenced in the body.
  const artistProgress = useMemo(() => {
    const records = downloadsList().filter((r) => r.meta.artistId === artistId);
    return downloadProgress(
      records,
      records.map((r) => r.key),
    );
  }, [downloadsList, downloadsVersion, artistId]);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!state.library || !state.token || !artistId) return;
      const validator = listValidator(Number(updatedAt) || undefined);
      let albumList: Album[];
      let artistInfo: Artist | null;
      try {
        [albumList, artistInfo] = await Promise.all([
          gateway.listAlbums(state.library, artistId, state.token, validator),
          gateway.getArtist(state.library, artistId, state.token, validator),
        ]);
      } catch (err) {
        if (!alive) return;
        if (err instanceof OfflineUnavailable) {
          setOfflineEmpty(true);
          setLoading(false);
        } else {
          // Non-fatal: keep whatever's shown.
          setLoading(false);
        }
        return;
      }
      if (!alive) return;
      setAlbums(albumList);
      setArtist(artistInfo);
      setOfflineEmpty(false);
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
        // Resolve owned status: only keep artists found in the library.
        const resolved: SimilarArtistItem[] = [];
        for (const name of similarNames) {
          try {
            const results = await gateway.search(state.library, name, state.token);
            const lc = name.trim().toLowerCase();
            const match =
              results.artists.find((a) => a.name.trim().toLowerCase() === lc) ??
              results.artists.find(
                (a) =>
                  a.name.trim().toLowerCase().includes(lc) ||
                  lc.includes(a.name.trim().toLowerCase()),
              );
            if (alive && match) {
              resolved.push({
                name: match.name,
                artistId: match.id,
                serverId: match.serverId,
                thumb: match.thumb ?? null,
                updatedAt: match.updatedAt,
              });
            }
          } catch {
            // Search failure — skip this artist.
          }
        }
        if (alive) setSimilar(resolved);
      }
    })();
    return () => {
      alive = false;
    };
  }, [state.library, state.token, artistId, updatedAt, gateway, lastfm]);

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

  if (offlineEmpty) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          paddingTop: theme.space(6),
          backgroundColor: theme.bg,
        }}
      >
        <Text style={{ color: theme.textDim, fontSize: 15, textAlign: "center" }}>
          Not available offline.{"\n"}Connect to Plex to view this artist.
        </Text>
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
            let sArt: string | null = null;
            try {
              const sBase = artBaseFor(s.serverId);
              sArt = sBase && token && s.thumb ? artUrl(sBase, s.thumb, token) : null;
            } catch {
              // Server not yet connected — fall through to placeholder.
            }
            return (
              <Pressable
                key={s.artistId}
                onPress={() =>
                  router.push({
                    pathname: "/(tabs)/library/albums",
                    params: {
                      artistId: s.artistId,
                      updatedAt: s.updatedAt != null ? String(s.updatedAt) : "",
                    },
                  })
                }
              >
                <View style={{ alignItems: "center", width: similarTileSize }}>
                  <AlbumArt url={sArt} size={similarTileSize} circular />
                  <Text
                    style={{
                      color: theme.text,
                      fontSize: 11,
                      marginTop: 4,
                      textAlign: "center",
                    }}
                    numberOfLines={2}
                  >
                    {s.name}
                  </Text>
                </View>
              </Pressable>
            );
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
                ? gateway.listArtistTracks(
                    artistId,
                    state.library,
                    state.token,
                    listValidator(Number(updatedAt) || undefined),
                  )
                : []
            }
          />
          <DownloadProgressBar progress={artistProgress} />
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
              router.push({
                pathname: "/(tabs)/library/tracks",
                params: { albumId: item.id, updatedAt: item.updatedAt ?? "" },
              })
            }
          />
        );
      }}
    />
  );
}
