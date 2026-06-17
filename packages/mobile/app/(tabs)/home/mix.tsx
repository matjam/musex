import type { SmartKind, Track } from "@musex/core";
import { composeForYou, computeSmartPlaylist, SMART_TITLES } from "@musex/core";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { buildForYouInput } from "../../../src/logic/home-data";
import { useStore } from "../../../src/state/store";
import { TrackList } from "../../../src/ui/TrackList";
import { theme } from "../../../src/ui/theme";

export default function MixScreen() {
  const { kind } = useLocalSearchParams<{ kind: SmartKind }>();
  const { state, gateway, session, taste, artBaseFor, token } = useStore();
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!state.library || !state.token || !kind) return;
      setLoading(true);
      const snap = taste.snapshot();
      const allTracks = await gateway.listAllTracks(state.library, "title", state.token);
      let result: Track[];
      if (kind === "for-you") {
        const artists = await gateway.listArtists(state.library, state.token);
        result = composeForYou(
          buildForYouInput(snap.topArtists, artists, allTracks, snap.trackStats, snap.nowMs),
        );
      } else {
        result = computeSmartPlaylist(
          kind,
          allTracks,
          snap.trackStats,
          snap.topArtists,
          snap.nowMs,
        );
      }
      if (alive) {
        setTracks(result);
        setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [kind, state.library, state.token, gateway, taste]);

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: "center", backgroundColor: theme.bg }}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }

  return (
    <TrackList
      title={kind ? SMART_TITLES[kind] : "Mix"}
      tracks={tracks}
      session={session}
      artBaseFor={artBaseFor}
      token={token}
    />
  );
}
