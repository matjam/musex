import { formatDuration } from "@musex/core";
import Slider from "@react-native-community/slider";
import { useRouter } from "expo-router";
import { Pause, Play, SkipBack, SkipForward } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { artUrl } from "../logic/art-url";
import { useStore } from "../state/store";
import { AlbumArt } from "./AlbumArt";
import { theme } from "./theme";

// iPad full-width bottom player bar (desktop mirror). Mounted only in the pad
// branch of the tabs layout; the phone keeps MiniPlayer. Store/session access
// mirrors MiniPlayer exactly (playback state via the store; no new state).
export function PlayerBar() {
  const { state, session, artBaseFor, token } = useStore();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const pb = state.playback;
  // PlaybackState has no `current`: derive it from the queue.
  const current = pb?.queue ? pb.queue.tracks[pb.queue.index] : undefined;
  if (!pb || !current) return null;

  const playing = pb.status === "playing";
  const base = artBaseFor(current.serverId);
  const url = base && token ? artUrl(base, current.thumb, token) : null;
  const durationSec = pb.durationSec || current.durationMs / 1000;

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: theme.space(2),
        minHeight: 64,
        backgroundColor: theme.surface,
        borderTopWidth: 1,
        borderTopColor: theme.border,
        paddingHorizontal: theme.space(2),
        paddingVertical: theme.space(1),
        paddingBottom: insets.bottom + theme.space(1),
      }}
    >
      <Pressable
        onPress={() => router.push("/now-playing")}
        style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1 }}
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
      </Pressable>

      {/* Transport */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: theme.space(3) }}>
        <Pressable onPress={() => void session.previous()} hitSlop={10}>
          <SkipBack color={theme.text} size={22} />
        </Pressable>
        <Pressable onPress={() => (playing ? session.pause() : session.play())} hitSlop={10}>
          {playing ? (
            <Pause color={theme.accent} size={30} />
          ) : (
            <Play color={theme.accent} size={30} />
          )}
        </Pressable>
        <Pressable onPress={() => void session.next()} hitSlop={10}>
          <SkipForward color={theme.text} size={22} />
        </Pressable>
      </View>

      {/* Seek */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          minWidth: 280,
          flex: 1,
        }}
      >
        <Text style={{ color: theme.textDim, fontSize: 11, minWidth: 36, textAlign: "right" }}>
          {formatDuration(pb.positionSec * 1000)}
        </Text>
        <Slider
          style={{ flex: 1 }}
          minimumValue={0}
          maximumValue={durationSec}
          value={pb.positionSec}
          minimumTrackTintColor={theme.accent}
          maximumTrackTintColor={theme.border}
          thumbTintColor={theme.text}
          onSlidingComplete={(v) => session.seek(v)}
        />
        <Text style={{ color: theme.textDim, fontSize: 11, minWidth: 36 }}>
          {formatDuration(durationSec * 1000)}
        </Text>
      </View>
    </View>
  );
}
