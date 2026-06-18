import type { Track } from "@musex/core";
import { type SearchResults, searchLibrary } from "@musex/core";
import { useRouter } from "expo-router";
import { EllipsisVertical } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { FlatList, Pressable, Text, TextInput, View } from "react-native";
import { artUrl } from "../../../src/logic/art-url";
import { useStore } from "../../../src/state/store";
import { AlbumArt } from "../../../src/ui/AlbumArt";
import { BrowseGrid } from "../../../src/ui/BrowseGrid";
import { TrackActionSheet } from "../../../src/ui/TrackActionSheet";
import { theme } from "../../../src/ui/theme";

const EMPTY: SearchResults = { artists: [], albums: [], tracks: [] };

export default function SearchScreen() {
  const { gateway, token, playTracks, artBaseFor } = useStore();
  const library = useStore().state.library;
  const router = useRouter();
  const [q, setQ] = useState("");
  const [res, setRes] = useState<SearchResults>(EMPTY);
  const [sheetTrack, setSheetTrack] = useState<Track | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!library || !token) return;
    if (timer.current) clearTimeout(timer.current);
    if (!q.trim()) {
      setRes(EMPTY);
      return;
    }
    timer.current = setTimeout(() => {
      searchLibrary(gateway, library, q, token)
        .then(setRes)
        .catch(() => setRes(EMPTY));
    }, 250);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [q, library, token, gateway]);

  function art(serverId: string, thumb?: string): string | null {
    const b = artBaseFor(serverId);
    return b && token ? artUrl(b, thumb, token) : null;
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <TextInput
        value={q}
        onChangeText={setQ}
        placeholder="Search artists, albums, tracks…"
        placeholderTextColor={theme.textDim}
        style={{
          backgroundColor: theme.surface,
          color: theme.text,
          margin: 12,
          borderRadius: 8,
          padding: 10,
        }}
      />
      {q.trim() === "" ? (
        <BrowseGrid />
      ) : (
        <FlatList
          data={res.tracks}
          keyExtractor={(t, i) => `${t.id}-${i}`}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            <View>
              {res.artists.length > 0 ? <Text style={hdr}>Artists</Text> : null}
              {res.artists.slice(0, 4).map((a) => (
                <Pressable
                  key={a.id}
                  onPress={() =>
                    router.push({
                      pathname: "/(tabs)/library/albums",
                      params: { artistId: a.id },
                    } as never)
                  }
                  style={rowS}
                >
                  <AlbumArt url={art(a.serverId, a.thumb)} size={44} circular />
                  <Text style={{ color: theme.text }} numberOfLines={1}>
                    {a.name}
                  </Text>
                </Pressable>
              ))}
              {res.albums.length > 0 ? <Text style={hdr}>Albums</Text> : null}
              {res.albums.slice(0, 4).map((al) => (
                <Pressable
                  key={al.id}
                  onPress={() =>
                    router.push({
                      pathname: "/(tabs)/library/tracks",
                      params: { albumId: al.id },
                    } as never)
                  }
                  style={rowS}
                >
                  <AlbumArt url={art(al.serverId, al.thumb)} size={44} />
                  <Text style={{ color: theme.text }} numberOfLines={1}>
                    {al.title}
                  </Text>
                </Pressable>
              ))}
              {res.tracks.length > 0 ? <Text style={hdr}>Tracks</Text> : null}
            </View>
          }
          renderItem={({ item }) => (
            <Pressable
              onLongPress={() => setSheetTrack(item)}
              onPress={() => void playTracks([item], 0)}
              style={rowS}
            >
              <AlbumArt url={art(item.serverId, item.thumb)} size={44} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.text }} numberOfLines={1}>
                  {item.title}
                </Text>
                <Text style={{ color: theme.textDim, fontSize: 12 }} numberOfLines={1}>
                  {item.artistName}
                </Text>
              </View>
              <Pressable hitSlop={8} onPress={() => setSheetTrack(item)} style={{ padding: 6 }}>
                <EllipsisVertical color={theme.textDim} size={20} />
              </Pressable>
            </Pressable>
          )}
        />
      )}
      <TrackActionSheet
        track={sheetTrack}
        visible={sheetTrack !== null}
        onClose={() => setSheetTrack(null)}
      />
    </View>
  );
}

const hdr = {
  color: theme.textDim,
  fontSize: 11,
  textTransform: "uppercase" as const,
  paddingHorizontal: 16,
  paddingTop: 12,
  paddingBottom: 4,
  fontWeight: "700" as const,
};
const rowS = {
  flexDirection: "row" as const,
  alignItems: "center" as const,
  gap: 12,
  paddingHorizontal: 16,
  paddingVertical: 8,
};
