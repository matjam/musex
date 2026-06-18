import type { Track } from "@musex/core";
import { composeMoodMix, listValidator, MOOD_MIXES } from "@musex/core";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { useStore } from "../../../src/state/store";
import { TrackList } from "../../../src/ui/TrackList";
import { theme } from "../../../src/ui/theme";

export default function MixScreen() {
  const { mood } = useLocalSearchParams<{ mood: string }>();
  const { gateway, session, taste, artBaseFor, token } = useStore();
  const library = useStore().state.library;
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!library || !token || !mood) return;
      setLoading(true);
      const mix = MOOD_MIXES.find((m) => m.id === mood);
      if (!mix) {
        if (alive) setLoading(false);
        return;
      }
      const snap = taste.snapshot();
      const validator = listValidator(library.updatedAt);
      let albums: Awaited<ReturnType<typeof gateway.listAllAlbums>>;
      let allTracks: Track[];
      try {
        [albums, allTracks] = await Promise.all([
          gateway.listAllAlbums(library, "title", token, validator),
          gateway.listAllTracks(library, "title", token, validator),
        ]);
      } catch {
        // Offline / not cached -> empty mix.
        if (alive) {
          setTracks([]);
          setLoading(false);
        }
        return;
      }

      // Build the stat map composeMoodMix expects (keyed by smartTrackKey).
      const stats = new Map(
        snap.trackStats.map((s) => [
          s.key,
          { plays: s.plays, skips: s.skips, ratingStars: s.ratingStars },
        ]),
      );

      const result = composeMoodMix(mix, albums, allTracks, stats, snap.topArtists);
      if (alive) {
        setTracks(result);
        setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [mood, library, token, gateway, taste]);

  const mix = mood ? MOOD_MIXES.find((m) => m.id === mood) : undefined;

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: "center", backgroundColor: theme.bg }}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }

  return (
    <TrackList
      title={mix?.title ?? "Mix"}
      tracks={tracks}
      session={session}
      artBaseFor={artBaseFor}
      token={token}
    />
  );
}
