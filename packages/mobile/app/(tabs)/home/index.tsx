import type { Playlist, SmartKind, Track } from "@musex/core";
import { recentlyPlayedTracks, SMART_TITLES, smartMixEmpty, smartMixThumbs } from "@musex/core";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { artUrl } from "../../../src/logic/art-url";
import { useStore } from "../../../src/state/store";
import { AlbumArt } from "../../../src/ui/AlbumArt";
import { Collage } from "../../../src/ui/Collage";
import { theme } from "../../../src/ui/theme";

const MIX_KINDS: SmartKind[] = ["for-you", "top-rated", "heavy-rotation", "rediscover"];
const CARD = 130;

export default function HomeScreen() {
  const { state, gateway, taste, artBaseFor, token, playTracks } = useStore();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [mixes, setMixes] = useState<{ kind: SmartKind; thumbs: string[] }[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [recent, setRecent] = useState<Track[]>([]);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        if (!state.library || !state.token) return;
        setLoading(true);
        try {
          const [allTracks, pls] = await Promise.all([
            gateway.listAllTracks(state.library, "title", state.token),
            gateway.listPlaylists(state.library, state.token).catch(() => [] as Playlist[]),
          ]);
          const snap = taste.snapshot();
          const builtMixes = MIX_KINDS.filter(
            (k) => !smartMixEmpty(k, allTracks, snap.trackStats, snap.topArtists, snap.nowMs),
          ).map((k) => ({
            kind: k,
            thumbs: smartMixThumbs(k, allTracks, snap.trackStats, snap.topArtists, snap.nowMs),
          }));
          const rec = recentlyPlayedTracks(snap.trackStats, allTracks, 12);
          if (alive) {
            setMixes(builtMixes);
            setPlaylists(pls);
            setRecent(rec);
            setLoading(false);
          }
        } catch {
          if (alive) {
            setMixes([]);
            setPlaylists([]);
            setRecent([]);
            setLoading(false);
          }
        }
      })();
      return () => {
        alive = false;
      };
    }, [state.library, state.token, gateway, taste]),
  );

  const base = state.library ? artBaseFor(state.library.serverId) : null;
  const bake = (thumb?: string) => (base && token && thumb ? artUrl(base, thumb, token) : null);

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: "center", backgroundColor: theme.bg }}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.bg }}
      contentContainerStyle={{ paddingVertical: theme.space(1) }}
    >
      {mixes.length > 0 ? (
        <Section title="Made for you">
          {mixes.map((m) => (
            <Pressable
              key={m.kind}
              onPress={() =>
                router.push({ pathname: "/(tabs)/home/mix", params: { kind: m.kind } })
              }
              style={{ width: CARD }}
            >
              <Collage urls={m.thumbs.slice(0, 4).map(bake)} size={CARD} />
              <Text numberOfLines={2} style={cardLabel}>
                {SMART_TITLES[m.kind]}
              </Text>
            </Pressable>
          ))}
        </Section>
      ) : null}

      {playlists.length > 0 ? (
        <Section title="Your playlists">
          {playlists.map((p) => (
            <Pressable
              key={p.id}
              onPress={() =>
                router.push({
                  pathname: "/(tabs)/home/playlist",
                  params: { id: p.id, serverId: p.serverId },
                })
              }
              style={{ width: CARD }}
            >
              <AlbumArt url={bake(p.thumb)} size={CARD} />
              <Text numberOfLines={2} style={cardLabel}>
                {p.title}
              </Text>
              <Text numberOfLines={1} style={cardSub}>
                {p.trackCount} tracks
              </Text>
            </Pressable>
          ))}
        </Section>
      ) : null}

      {recent.length > 0 ? (
        <Section title="Recently played">
          {recent.map((t) => {
            const tb = artBaseFor(t.serverId);
            const art = tb && token ? artUrl(tb, t.thumb, token) : null;
            return (
              <Pressable key={t.id} onPress={() => void playTracks([t], 0)} style={{ width: CARD }}>
                <AlbumArt url={art} size={CARD} />
                <Text numberOfLines={2} style={cardLabel}>
                  {t.title}
                </Text>
                <Text numberOfLines={1} style={cardSub}>
                  {t.artistName}
                </Text>
              </Pressable>
            );
          })}
        </Section>
      ) : null}

      {mixes.length === 0 && playlists.length === 0 && recent.length === 0 ? (
        <Text
          style={{
            color: theme.textDim,
            textAlign: "center",
            marginTop: theme.space(6),
            paddingHorizontal: theme.space(3),
          }}
        >
          Start playing music and your mixes will appear here.
        </Text>
      ) : null}
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: theme.space(2) }}>
      <Text
        style={{
          color: theme.text,
          fontSize: 18,
          fontWeight: "700",
          paddingHorizontal: theme.space(2),
          marginBottom: theme.space(1),
        }}
      >
        {title}
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 12, paddingHorizontal: theme.space(2) }}
      >
        {children}
      </ScrollView>
    </View>
  );
}

const cardLabel = { color: theme.text, fontSize: 13, fontWeight: "600" as const, marginTop: 6 };
const cardSub = { color: theme.textDim, fontSize: 11, marginTop: 2 };
