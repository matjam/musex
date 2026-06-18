import type { Track } from "@musex/core";
import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { useStore } from "../../../src/state/store";
import { TrackList } from "../../../src/ui/TrackList";
import { theme } from "../../../src/ui/theme";

export default function PlaylistScreen() {
  const { id, serverId } = useLocalSearchParams<{ id: string; serverId: string }>();
  const { state, gateway, session, artBaseFor, token } = useStore();
  const [tracks, setTracks] = useState<Track[]>([]);
  const [playlistItemIds, setPlaylistItemIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchTracks = useCallback(async () => {
    if (!state.token || !id || !serverId) return;
    setLoading(true);
    const items = await gateway.listPlaylistTracks(id, serverId, state.token);
    setTracks(items.map((it) => it.track));
    setPlaylistItemIds(items.map((it) => it.playlistItemId));
    setLoading(false);
  }, [id, serverId, state.token, gateway]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      if (!state.token || !id || !serverId) return;
      setLoading(true);
      const items = await gateway.listPlaylistTracks(id, serverId, state.token);
      if (alive) {
        setTracks(items.map((it) => it.track));
        setPlaylistItemIds(items.map((it) => it.playlistItemId));
        setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [id, serverId, state.token, gateway]);

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: "center", backgroundColor: theme.bg }}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }

  return (
    <TrackList
      title="Playlist"
      tracks={tracks}
      session={session}
      artBaseFor={artBaseFor}
      token={token}
      playlistId={id}
      playlistItemIds={playlistItemIds}
      onTracksChanged={() => void fetchTracks()}
    />
  );
}
