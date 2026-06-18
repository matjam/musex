import type { PlaybackSession, Track } from "@musex/core";
import Slider from "@react-native-community/slider";
import { useRouter } from "expo-router";
import {
  ChevronDown,
  Pause,
  Play,
  Repeat,
  Shuffle,
  SkipBack,
  SkipForward,
} from "lucide-react-native";
import { memo, useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import { artUrl } from "../src/logic/art-url";
import { useStore } from "../src/state/store";
import { AlbumArt } from "../src/ui/AlbumArt";
import { StarRating } from "../src/ui/StarRating";
import { theme } from "../src/ui/theme";

function fmt(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

// Memoized so Up Next rows DON'T re-render on every ~250ms position tick. The
// screen re-renders 4x/sec to advance the scrubber; without this the entire
// queue list (each row an <AlbumArt>) re-rendered every tick, saturating the JS
// thread and freezing the UI on any control tap. Props are stable by value
// across ticks (`art` is the same URL string; `track`/`abs`/`session` unchanged).
const QueueRow = memo(function QueueRow({
  track,
  art,
  abs,
  session,
}: {
  track: Track;
  art: string | null;
  abs: number;
  session: PlaybackSession;
}) {
  return (
    <Pressable
      onPress={() => void session.jumpTo(abs)}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingVertical: 8,
        paddingHorizontal: theme.space(3),
      }}
    >
      <AlbumArt url={art} size={36} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: theme.text }} numberOfLines={1}>
          {track.title}
        </Text>
        <Text style={{ color: theme.textDim, fontSize: 12 }} numberOfLines={1}>
          {track.artistName}
        </Text>
      </View>
    </Pressable>
  );
});

export default function NowPlaying() {
  const { state, session, gateway, taste, artBaseFor, token } = useStore();
  const router = useRouter();
  const pb = state.playback;
  const queue = pb?.queue ?? null;
  const current = queue ? queue.tracks[queue.index] : undefined;

  // Stable across position ticks (queue ref only changes on a real queue/index
  // change), so the FlatList `data` reference doesn't churn 4x/sec.
  const upNext = useMemo(() => (queue ? queue.tracks.slice(queue.index + 1) : []), [queue]);
  const baseIndex = queue ? queue.index : 0;

  // Rating state — optimistically updated, synced when track changes.
  const [rating, setRating] = useState<number | null>(current?.userRating ?? null);
  useEffect(() => {
    setRating(current?.userRating ?? null);
  }, [current]);

  async function rate(r: number | null) {
    if (!current) return;
    setRating(r); // optimistic
    try {
      await gateway.rateItem(current.serverId, current.id, r, token ?? "");
      taste.recordTrackRating({ title: current.title, artistName: current.artistName }, r);
    } catch {
      setRating(current.userRating ?? null); // revert on failure
    }
  }

  if (!pb || !queue || !current) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: theme.bg,
        }}
      >
        <Text style={{ color: theme.textDim }}>Nothing playing</Text>
      </View>
    );
  }

  const playing = pb.status === "playing";
  const base = artBaseFor(current.serverId);
  const artUri = base && token ? artUrl(base, current.thumb, token) : null;
  const dur = pb.durationSec || current.durationMs / 1000;

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <Pressable
        onPress={() => router.back()}
        style={{ padding: theme.space(1.5), alignSelf: "flex-start" }}
      >
        <ChevronDown color={theme.text} size={28} />
      </Pressable>

      <FlatList
        data={upNext}
        keyExtractor={(t, i) => `${t.id}-${i}`}
        ListHeaderComponent={
          <View style={{ alignItems: "center", paddingHorizontal: theme.space(3) }}>
            <AlbumArt url={artUri} size={240} />
            <Text
              style={{ color: theme.text, fontSize: 20, fontWeight: "700", marginTop: 18 }}
              numberOfLines={1}
            >
              {current.title}
            </Text>
            <Text style={{ color: theme.textDim, fontSize: 15 }} numberOfLines={1}>
              {current.artistName}
            </Text>
            <View style={{ marginTop: 10 }}>
              <StarRating rating10={rating} onRate={(r) => void rate(r)} size={22} />
            </View>

            <Slider
              style={{ width: "100%", marginTop: 18 }}
              minimumValue={0}
              maximumValue={dur}
              value={pb.positionSec}
              minimumTrackTintColor={theme.accent}
              maximumTrackTintColor={theme.border}
              thumbTintColor={theme.text}
              onSlidingComplete={(v) => session.seek(v)}
            />
            <View style={{ flexDirection: "row", justifyContent: "space-between", width: "100%" }}>
              <Text style={{ color: theme.textDim, fontSize: 12 }}>{fmt(pb.positionSec)}</Text>
              <Text style={{ color: theme.textDim, fontSize: 12 }}>{fmt(dur)}</Text>
            </View>

            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 28, marginVertical: 18 }}
            >
              <Pressable onPress={() => session.setShuffle(!queue.shuffle)} hitSlop={10}>
                <Shuffle color={queue.shuffle ? theme.accent : theme.textDim} size={22} />
              </Pressable>
              <Pressable onPress={() => void session.previous()} hitSlop={10}>
                <SkipBack color={theme.text} size={30} />
              </Pressable>
              <Pressable onPress={() => (playing ? session.pause() : session.play())} hitSlop={10}>
                {playing ? (
                  <Pause color={theme.accent} size={44} />
                ) : (
                  <Play color={theme.accent} size={44} />
                )}
              </Pressable>
              <Pressable onPress={() => void session.next()} hitSlop={10}>
                <SkipForward color={theme.text} size={30} />
              </Pressable>
              <Pressable onPress={() => session.cycleRepeat()} hitSlop={10}>
                <Repeat color={queue.repeat === "none" ? theme.textDim : theme.accent} size={22} />
              </Pressable>
            </View>

            {upNext.length > 0 ? (
              <Text
                style={{
                  color: theme.textDim,
                  fontSize: 11,
                  textTransform: "uppercase",
                  alignSelf: "flex-start",
                  marginBottom: 6,
                }}
              >
                Up Next
              </Text>
            ) : null}
          </View>
        }
        renderItem={({ item, index }) => {
          const b = artBaseFor(item.serverId);
          const u = b && token ? artUrl(b, item.thumb, token) : null;
          return <QueueRow track={item} art={u} abs={baseIndex + 1 + index} session={session} />;
        }}
      />
    </View>
  );
}
