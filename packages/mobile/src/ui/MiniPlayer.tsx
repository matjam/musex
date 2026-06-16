import { Pause, Play, SkipBack, SkipForward } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";
import { useStore } from "../state/store";
import { theme } from "./theme";

function fmt(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

export function MiniPlayer() {
  const { state, session } = useStore();
  const pb = state.playback;
  // PlaybackState has no `current`: derive it from the queue.
  const current = pb?.queue ? pb.queue.tracks[pb.queue.index] : undefined;
  if (!pb || !current) return null;

  const playing = pb.status === "playing";
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        backgroundColor: theme.surface,
        borderTopWidth: 1,
        borderTopColor: theme.border,
        paddingHorizontal: theme.space(2),
        paddingVertical: theme.space(1.5),
        gap: theme.space(1.5),
      }}
    >
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={{ color: theme.text, fontWeight: "600" }}>
          {current.title}
        </Text>
        <Text numberOfLines={1} style={{ color: theme.textDim, fontSize: 12 }}>
          {current.artistName} · {fmt(pb.positionSec)} / {fmt(current.durationMs / 1000)}
        </Text>
      </View>
      <Pressable onPress={() => void session.previous()} hitSlop={8}>
        <SkipBack size={22} color={theme.text} />
      </Pressable>
      <Pressable onPress={() => (playing ? session.pause() : session.play())} hitSlop={8}>
        {playing ? (
          <Pause size={26} color={theme.accent} />
        ) : (
          <Play size={26} color={theme.accent} />
        )}
      </Pressable>
      <Pressable onPress={() => void session.next()} hitSlop={8}>
        <SkipForward size={22} color={theme.text} />
      </Pressable>
    </View>
  );
}
