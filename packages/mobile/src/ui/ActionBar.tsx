import { buildQueue, type PlaybackSession, type Track } from "@musex/core";
import { ListPlus, Play, Shuffle } from "lucide-react-native";
import { useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { theme } from "./theme";

export function ActionBar({
  session,
  getTracks,
}: {
  session: PlaybackSession;
  getTracks: () => Track[] | Promise<Track[]>;
}) {
  const [busy, setBusy] = useState(false);

  async function run(action: (tracks: Track[]) => void | Promise<void>) {
    if (busy) return;
    setBusy(true);
    try {
      // getTracks may be a cached gateway call that rejects with OfflineUnavailable
      // (e.g. the artist page's listArtistTracks). Treat any failure as "no tracks"
      // so a play/shuffle/queue button is a graceful no-op rather than an unhandled throw.
      let tracks: Track[];
      try {
        tracks = await getTracks();
      } catch {
        tracks = [];
      }
      if (tracks.length) await action(tracks);
    } finally {
      setBusy(false);
    }
  }

  const Btn = ({
    icon,
    label,
    onPress,
  }: {
    icon: React.ReactNode;
    label: string;
    onPress: () => void;
  }) => (
    <Pressable
      onPress={onPress}
      disabled={busy}
      style={{ flex: 1, alignItems: "center", gap: 4, paddingVertical: 8, opacity: busy ? 0.5 : 1 }}
    >
      {icon}
      <Text style={{ color: theme.textDim, fontSize: 10 }}>{label}</Text>
    </Pressable>
  );

  return (
    <View style={{ flexDirection: "row", paddingHorizontal: theme.space(1) }}>
      {busy ? (
        <View style={{ flex: 1, alignItems: "center", paddingVertical: 8 }}>
          <ActivityIndicator color={theme.accent} />
        </View>
      ) : (
        <>
          <Btn
            icon={<Play color={theme.accent} size={20} />}
            label="Play"
            onPress={() => run((t) => session.loadQueue(buildQueue(t, 0)))}
          />
          <Btn
            icon={<Shuffle color={theme.text} size={20} />}
            label="Shuffle"
            onPress={() => run((t) => session.loadQueueShuffled(t))}
          />
          <Btn
            icon={<ListPlus color={theme.text} size={20} />}
            label="Add to Queue"
            onPress={() => run((t) => session.enqueueEnd(t))}
          />
        </>
      )}
    </View>
  );
}
