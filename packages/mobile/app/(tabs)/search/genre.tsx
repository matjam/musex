import type { Track } from "@musex/core";
import { listValidator, tracksForGenre } from "@musex/core";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { useStore } from "../../../src/state/store";
import { TrackList } from "../../../src/ui/TrackList";
import { theme } from "../../../src/ui/theme";

export default function GenreScreen() {
  const { genre } = useLocalSearchParams<{ genre: string }>();
  const { gateway, session, artBaseFor, token } = useStore();
  const library = useStore().state.library;
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!library || !token || !genre) return;
      setLoading(true);
      const validator = listValidator(library.updatedAt);
      try {
        const [albums, allTracks] = await Promise.all([
          gateway.listAllAlbums(library, "title", token, validator),
          gateway.listAllTracks(library, "title", token, validator),
        ]);
        const result = tracksForGenre(genre, albums, allTracks);
        if (alive) {
          setTracks(result);
          setLoading(false);
        }
      } catch {
        // Offline / not cached -> empty genre list.
        if (alive) {
          setTracks([]);
          setLoading(false);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [genre, library, token, gateway]);

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: "center", backgroundColor: theme.bg }}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }

  return (
    <TrackList
      title={genre ?? "Genre"}
      tracks={tracks}
      session={session}
      artBaseFor={artBaseFor}
      token={token}
    />
  );
}
