import { useRouter } from "expo-router";
import { Pause, Play, SkipForward } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";
import { useStore } from "../state/store";
import { AlbumArt } from "./AlbumArt";
import { theme } from "./theme";

export function MiniPlayer() {
  const { state, session, artSourceFor } = useStore();
  const router = useRouter();
  const pb = state.playback;
  // PlaybackState has no `current`: derive it from the queue.
  const current = pb?.queue ? pb.queue.tracks[pb.queue.index] : undefined;
  if (!pb || !current) return null;

  const playing = pb.status === "playing";
  const url = artSourceFor(current.serverId, current.thumb, current.albumId);

  return (
    <Pressable
      onPress={() => router.push("/now-playing")}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        backgroundColor: theme.surface,
        borderTopWidth: 1,
        borderTopColor: theme.border,
        paddingHorizontal: theme.space(1.5),
        paddingVertical: theme.space(1),
      }}
    >
      <AlbumArt url={url} size={40} />
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={{ color: theme.text, fontWeight: "600" }}>
          {current.title}
        </Text>
        <Text numberOfLines={1} style={{ color: theme.textDim, fontSize: 12 }}>
          {current.artistName}
        </Text>
      </View>
      <Pressable onPress={() => (playing ? session.pause() : session.play())} hitSlop={10}>
        {playing ? (
          <Pause color={theme.accent} size={26} />
        ) : (
          <Play color={theme.accent} size={26} />
        )}
      </Pressable>
      <Pressable onPress={() => void session.next()} hitSlop={10} style={{ marginLeft: 6 }}>
        <SkipForward color={theme.text} size={22} />
      </Pressable>
    </Pressable>
  );
}
