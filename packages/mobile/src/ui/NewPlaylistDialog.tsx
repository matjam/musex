import { useState } from "react";
import { Modal, Pressable, Text, TextInput, View } from "react-native";
import { theme } from "./theme";

export function NewPlaylistDialog({
  visible,
  onCancel,
  onCreate,
}: {
  visible: boolean;
  onCancel: () => void;
  onCreate: (name: string) => void;
}) {
  const [name, setName] = useState("");
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={{ flex: 1, backgroundColor: "#000a", justifyContent: "center", padding: 24 }}>
        <View style={{ backgroundColor: theme.surface, borderRadius: 12, padding: 16 }}>
          <Text style={{ color: theme.text, fontWeight: "700", fontSize: 15, marginBottom: 10 }}>
            New playlist
          </Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Playlist name"
            placeholderTextColor={theme.textDim}
            autoFocus
            style={{
              backgroundColor: theme.bg,
              borderColor: theme.accent,
              borderWidth: 1,
              borderRadius: 8,
              padding: 10,
              color: theme.text,
            }}
          />
          <View
            style={{ flexDirection: "row", justifyContent: "flex-end", gap: 12, marginTop: 14 }}
          >
            <Pressable onPress={onCancel} style={{ paddingVertical: 6, paddingHorizontal: 14 }}>
              <Text style={{ color: theme.textDim }}>Cancel</Text>
            </Pressable>
            <Pressable
              disabled={!name.trim()}
              onPress={() => {
                onCreate(name.trim());
                setName("");
              }}
              style={{
                paddingVertical: 6,
                paddingHorizontal: 14,
                borderRadius: 8,
                backgroundColor: theme.accent,
                opacity: name.trim() ? 1 : 0.4,
              }}
            >
              <Text style={{ color: "#000", fontWeight: "700" }}>Create</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
