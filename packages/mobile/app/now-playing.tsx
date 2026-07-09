import type { PlaybackSession, Track } from "@musex/core";
import Slider from "@react-native-community/slider";
import { useRouter } from "expo-router";
import {
  ChevronDown,
  GripVertical,
  Pause,
  Play,
  Radio,
  Repeat,
  Shuffle,
  SkipBack,
  SkipForward,
  Trash2,
  X,
} from "lucide-react-native";
import { memo, useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import DraggableFlatList, { type RenderItemParams } from "react-native-draggable-flatlist";
import { GestureHandlerRootView, Swipeable } from "react-native-gesture-handler";
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
  onDrag,
  active,
}: {
  track: Track;
  art: string | null;
  abs: number;
  session: PlaybackSession;
  onDrag?: () => void;
  active?: boolean;
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
        backgroundColor: active ? theme.surface : "transparent",
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
      {onDrag ? (
        <Pressable onLongPress={onDrag} hitSlop={8} style={{ padding: 4 }}>
          <GripVertical color={theme.textDim} size={18} />
        </Pressable>
      ) : null}
    </Pressable>
  );
});

export default function NowPlaying() {
  const {
    state,
    session,
    gateway,
    taste,
    artSourceFor,
    token,
    lastfm,
    getLastfmConfig,
    radio,
    stopRadio,
  } = useStore();
  const router = useRouter();
  const pb = state.playback;
  const queue = pb?.queue ?? null;
  const current = queue ? queue.tracks[queue.index] : undefined;

  // Stable across position ticks (queue ref only changes on a real queue/index
  // change), so the DraggableFlatList `data` reference doesn't churn 4x/sec.
  const upNext = useMemo(() => (queue ? queue.tracks.slice(queue.index + 1) : []), [queue]);
  const baseIndex = queue ? queue.index : 0;

  // Seek-drag guard: while the user drags, freeze the slider's controlled
  // value at the drag-start position so the ~250ms position ticks don't yank
  // the thumb out from under the finger mid-drag (same pattern as PlayerBar).
  const [isSliding, setIsSliding] = useState(false);
  const [sliderValue, setSliderValue] = useState(0);

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
      if (getLastfmConfig().loveOnRating) {
        const t = { artistName: current.artistName, title: current.title };
        if (r !== null && r >= 8) {
          void lastfm.love(t);
        } else {
          void lastfm.unlove(t);
        }
      }
    } catch {
      setRating(current.userRating ?? null); // revert on failure
    }
  }

  if (!pb || !queue || !current) {
    return (
      <GestureHandlerRootView style={{ flex: 1 }}>
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
      </GestureHandlerRootView>
    );
  }

  const playing = pb.status === "playing";
  const artUri = artSourceFor(current.serverId, current.thumb, current.albumId);
  const dur = pb.durationSec || current.durationMs / 1000;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <View style={{ flex: 1, backgroundColor: theme.bg }}>
        <Pressable
          onPress={() => router.back()}
          style={{ padding: theme.space(1.5), alignSelf: "flex-start" }}
        >
          <ChevronDown color={theme.text} size={28} />
        </Pressable>

        <DraggableFlatList
          data={upNext}
          keyExtractor={(t, i) => `${t.id}-${i}`}
          onDragEnd={({ from, to }) => void session.move(baseIndex + 1 + from, baseIndex + 1 + to)}
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
              {radio.active ? (
                <Pressable
                  onPress={stopRadio}
                  hitSlop={12}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 6,
                    backgroundColor: "#1db95433",
                    borderRadius: 12,
                    paddingHorizontal: 10,
                    paddingVertical: 4,
                    marginTop: 8,
                  }}
                >
                  <Radio color="#1db954" size={13} />
                  <Text style={{ color: "#1db954", fontSize: 12, fontWeight: "600" }}>
                    Radio · {radio.seedLabel}
                  </Text>
                  <X color="#1db954" size={13} />
                </Pressable>
              ) : null}
              <View style={{ marginTop: 10 }}>
                <StarRating rating10={rating} onRate={(r) => void rate(r)} size={22} />
              </View>

              <Slider
                style={{ width: "100%", marginTop: 18 }}
                minimumValue={0}
                maximumValue={Math.max(dur, 1)}
                value={isSliding ? sliderValue : pb.positionSec}
                minimumTrackTintColor={theme.accent}
                maximumTrackTintColor={theme.border}
                thumbTintColor={theme.text}
                onSlidingStart={(v) => {
                  setSliderValue(v);
                  setIsSliding(true);
                }}
                onSlidingComplete={(v) => {
                  session.seek(v);
                  setIsSliding(false);
                }}
              />
              <View
                style={{ flexDirection: "row", justifyContent: "space-between", width: "100%" }}
              >
                <Text style={{ color: theme.textDim, fontSize: 12 }}>{fmt(pb.positionSec)}</Text>
                <Text style={{ color: theme.textDim, fontSize: 12 }}>
                  {dur > 0 ? fmt(dur) : "–:––"}
                </Text>
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
                <Pressable
                  onPress={() => (playing ? session.pause() : session.play())}
                  hitSlop={10}
                >
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
                  <Repeat
                    color={queue.repeat === "none" ? theme.textDim : theme.accent}
                    size={22}
                  />
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
          renderItem={({ item, getIndex, drag, isActive }: RenderItemParams<Track>) => {
            const pos = getIndex() ?? 0;
            const abs = baseIndex + 1 + pos;
            const u = artSourceFor(item.serverId, item.thumb, item.albumId);
            return (
              <Swipeable
                renderRightActions={() => (
                  <Pressable
                    onPress={() => void session.removeAt(abs)}
                    style={{
                      backgroundColor: "#c0392b",
                      justifyContent: "center",
                      paddingHorizontal: 20,
                    }}
                  >
                    <Trash2 color="#fff" size={20} />
                  </Pressable>
                )}
              >
                <QueueRow
                  track={item}
                  art={u}
                  abs={abs}
                  session={session}
                  onDrag={drag}
                  active={isActive}
                />
              </Swipeable>
            );
          }}
        />
      </View>
    </GestureHandlerRootView>
  );
}
