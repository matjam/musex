import type { Playlist, SmartKind, Track } from "@musex/core";
import { recentlyPlayedTracks, SMART_TITLES, smartMixEmpty, smartMixThumbs } from "@musex/core";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { artUrl } from "../../../src/logic/art-url";
import { useStore } from "../../../src/state/store";
import { AlbumArt } from "../../../src/ui/AlbumArt";
import { Collage } from "../../../src/ui/Collage";
import { NewPlaylistDialog } from "../../../src/ui/NewPlaylistDialog";
import { theme } from "../../../src/ui/theme";

const MIX_KINDS: SmartKind[] = ["for-you", "top-rated", "heavy-rotation", "rediscover"];
const CARD = 130;

type PlaylistAction = { pl: Playlist; kind: "menu" | "rename" | "confirm-delete" };

export default function HomeScreen() {
  const { state, gateway, taste, artBaseFor, token, playTracks } = useStore();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [mixes, setMixes] = useState<{ kind: SmartKind; thumbs: string[] }[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [recent, setRecent] = useState<Track[]>([]);
  const [action, setAction] = useState<PlaylistAction | null>(null);

  const fetchPlaylists = useCallback(async () => {
    if (!state.library || !state.token) return;
    const pls = await gateway
      .listPlaylists(state.library, state.token)
      .catch(() => [] as Playlist[]);
    setPlaylists(pls);
  }, [state.library, state.token, gateway]);

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
    <>
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
                onLongPress={() => setAction({ pl: p, kind: "menu" })}
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
                <Pressable
                  key={t.id}
                  onPress={() => void playTracks([t], 0)}
                  style={{ width: CARD }}
                >
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

      {/* Playlist long-press action menu */}
      <Modal
        visible={action?.kind === "menu"}
        transparent
        animationType="slide"
        onRequestClose={() => setAction(null)}
      >
        <Pressable style={{ flex: 1, backgroundColor: "#0008" }} onPress={() => setAction(null)} />
        <View
          style={{
            backgroundColor: theme.surface,
            borderTopLeftRadius: 16,
            borderTopRightRadius: 16,
            paddingBottom: 28,
          }}
        >
          <View
            style={{
              padding: 16,
              borderBottomWidth: 1,
              borderBottomColor: theme.border,
            }}
          >
            <Text style={{ color: theme.text, fontWeight: "700", fontSize: 15 }} numberOfLines={1}>
              {action?.pl.title}
            </Text>
          </View>
          <ActionRow
            label="Rename"
            onPress={() => {
              if (action) setAction({ pl: action.pl, kind: "rename" });
            }}
          />
          <ActionRow
            label="Delete"
            danger
            onPress={() => {
              if (action) setAction({ pl: action.pl, kind: "confirm-delete" });
            }}
          />
        </View>
      </Modal>

      {/* Rename dialog — reuses NewPlaylistDialog seeded with current name */}
      <NewPlaylistDialog
        visible={action?.kind === "rename"}
        initialName={action?.pl.title ?? ""}
        title="Rename playlist"
        submitLabel="Rename"
        onCancel={() => setAction(null)}
        onCreate={async (name) => {
          if (!action) return;
          const { pl } = action;
          setAction(null);
          try {
            await gateway.renamePlaylist(pl.id, pl.serverId, name, token ?? "");
            await fetchPlaylists();
          } catch {
            // leave list as-is; server error is silent (user can retry)
          }
        }}
      />

      {/* Delete confirmation */}
      <Modal
        visible={action?.kind === "confirm-delete"}
        transparent
        animationType="fade"
        onRequestClose={() => setAction(null)}
      >
        <View style={{ flex: 1, backgroundColor: "#000a", justifyContent: "center", padding: 24 }}>
          <View style={{ backgroundColor: theme.surface, borderRadius: 12, padding: 16 }}>
            <Text style={{ color: theme.text, fontWeight: "700", fontSize: 15, marginBottom: 8 }}>
              Delete playlist?
            </Text>
            <Text style={{ color: theme.textDim, fontSize: 13, marginBottom: 16 }}>
              {`"${action?.pl.title}" will be permanently deleted.`}
            </Text>
            <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 12 }}>
              <Pressable
                onPress={() => setAction(null)}
                style={{ paddingVertical: 6, paddingHorizontal: 14 }}
              >
                <Text style={{ color: theme.textDim }}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={async () => {
                  if (!action) return;
                  const { pl } = action;
                  setAction(null);
                  try {
                    await gateway.deletePlaylist(pl.id, pl.serverId, token ?? "");
                    await fetchPlaylists();
                  } catch {
                    // leave list as-is
                  }
                }}
                style={{
                  paddingVertical: 6,
                  paddingHorizontal: 14,
                  borderRadius: 8,
                  backgroundColor: "#e5534b",
                }}
              >
                <Text style={{ color: "#fff", fontWeight: "700" }}>Delete</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

function ActionRow({
  label,
  onPress,
  danger,
}: {
  label: string;
  onPress: () => void;
  danger?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        paddingHorizontal: 16,
        paddingVertical: 14,
      }}
    >
      <Text style={{ color: danger ? "#e5534b" : theme.text, fontSize: 15 }}>{label}</Text>
    </Pressable>
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
