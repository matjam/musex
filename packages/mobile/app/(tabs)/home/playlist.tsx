import type { Track } from "@musex/core";
import { listValidator, OfflineUnavailable } from "@musex/core";
import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { useStore } from "../../../src/state/store";
import { TrackList } from "../../../src/ui/TrackList";
import { theme } from "../../../src/ui/theme";

export default function PlaylistScreen() {
  const { id, serverId, updatedAt, trackCount } = useLocalSearchParams<{
    id: string;
    serverId: string;
    updatedAt?: string;
    trackCount?: string;
  }>();
  const { state, gateway, session, artBaseFor, token } = useStore();
  const [tracks, setTracks] = useState<Track[]>([]);
  const [playlistItemIds, setPlaylistItemIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [offlineEmpty, setOfflineEmpty] = useState(false);

  // Playlist validator: updatedAt + trackCount (mirrors desktop's listValidator
  // (playlist.updatedAt, playlist.trackCount)). Threaded via route params and
  // computed inside each fetch so it's not an external hook dependency.
  const fetchTracks = useCallback(async () => {
    if (!state.token || !id || !serverId) return;
    const validator = listValidator(
      Number(updatedAt) || undefined,
      Number(trackCount) || undefined,
    );
    setLoading(true);
    try {
      const items = await gateway.listPlaylistTracks(id, serverId, state.token, validator);
      setTracks(items.map((it) => it.track));
      setPlaylistItemIds(items.map((it) => it.playlistItemId));
      setOfflineEmpty(false);
    } catch (err) {
      if (err instanceof OfflineUnavailable) setOfflineEmpty(true);
      // other errors: leave list as-is
    } finally {
      setLoading(false);
    }
  }, [id, serverId, state.token, gateway, updatedAt, trackCount]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      if (!state.token || !id || !serverId) return;
      const validator = listValidator(
        Number(updatedAt) || undefined,
        Number(trackCount) || undefined,
      );
      setLoading(true);
      try {
        const items = await gateway.listPlaylistTracks(id, serverId, state.token, validator);
        if (alive) {
          setTracks(items.map((it) => it.track));
          setPlaylistItemIds(items.map((it) => it.playlistItemId));
          setOfflineEmpty(false);
        }
      } catch (err) {
        if (alive && err instanceof OfflineUnavailable) setOfflineEmpty(true);
        // other errors: leave list as-is
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [id, serverId, state.token, gateway, updatedAt, trackCount]);

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
          Not available offline.{"\n"}Connect to Plex to view this playlist.
        </Text>
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
