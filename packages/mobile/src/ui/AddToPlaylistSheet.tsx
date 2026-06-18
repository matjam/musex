import type { Playlist, Track } from "@musex/core";
import { ListPlus, Plus } from "lucide-react-native";
import { useEffect, useState } from "react";
import { FlatList, Modal, Pressable, Text, View } from "react-native";
import { useStore } from "../state/store";
import { NewPlaylistDialog } from "./NewPlaylistDialog";
import { theme } from "./theme";

export function AddToPlaylistSheet({
  track,
  visible,
  onClose,
}: {
  track: Track | null;
  visible: boolean;
  onClose: () => void;
}) {
  const { gateway, token } = useStore();
  const library = useStore().state.library;
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [dialog, setDialog] = useState(false);

  useEffect(() => {
    if (!visible || !library || !token) return;
    let live = true;
    gateway
      .listPlaylists(library, token)
      .then((p) => live && setPlaylists(p))
      .catch(() => live && setPlaylists([]));
    return () => {
      live = false;
    };
  }, [visible, library, token, gateway]);

  async function addTo(playlistId: string) {
    if (!track) return;
    await gateway.addToPlaylist(playlistId, track.serverId, [track.id], token ?? "");
    onClose();
  }

  async function create(name: string) {
    if (!track || !library) return;
    await gateway.createPlaylist(library, name, [track.id], token ?? "");
    setDialog(false);
    onClose();
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: "#0008" }} onPress={onClose} />
      <View
        style={{
          backgroundColor: theme.surface,
          borderTopLeftRadius: 16,
          borderTopRightRadius: 16,
          paddingBottom: 28,
          maxHeight: "70%",
        }}
      >
        <Text style={{ color: theme.text, fontWeight: "700", padding: 16 }} numberOfLines={1}>
          Add "{track?.title}" to…
        </Text>
        <Pressable
          onPress={() => setDialog(true)}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            paddingHorizontal: 16,
            paddingVertical: 12,
          }}
        >
          <Plus color={theme.accent} size={20} />
          <Text style={{ color: theme.text }}>New playlist</Text>
        </Pressable>
        <FlatList
          data={playlists}
          keyExtractor={(p) => p.id}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => void addTo(item.id)}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                paddingHorizontal: 16,
                paddingVertical: 12,
              }}
            >
              <ListPlus color={theme.textDim} size={20} />
              <Text style={{ color: theme.text }} numberOfLines={1}>
                {item.title}
              </Text>
            </Pressable>
          )}
        />
      </View>
      <NewPlaylistDialog
        visible={dialog}
        onCancel={() => setDialog(false)}
        onCreate={(n) => void create(n)}
      />
    </Modal>
  );
}
