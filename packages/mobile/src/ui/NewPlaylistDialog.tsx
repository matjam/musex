import { useEffect, useState } from "react";
import { Modal, Pressable, Text, TextInput, View } from "react-native";
import { theme } from "./theme";

export function NewPlaylistDialog({
  visible,
  onCancel,
  onCreate,
  initialName = "",
  title = "New playlist",
  submitLabel = "Create",
}: {
  visible: boolean;
  onCancel: () => void;
  onCreate: (name: string) => void;
  /** Pre-fill the name field (e.g. when renaming). Default: "". */
  initialName?: string;
  /** Dialog heading. Default: "New playlist". */
  title?: string;
  /** Submit button label. Default: "Create". */
  submitLabel?: string;
}) {
  const [name, setName] = useState(initialName);

  // Sync whenever initialName changes so reopening with a different value works
  // (Modal stays mounted across visibility toggles).
  useEffect(() => {
    setName(initialName);
  }, [initialName]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={{ flex: 1, backgroundColor: "#000a", justifyContent: "center", padding: 24 }}>
        <View style={{ backgroundColor: theme.surface, borderRadius: 12, padding: 16 }}>
          <Text style={{ color: theme.text, fontWeight: "700", fontSize: 15, marginBottom: 10 }}>
            {title}
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
              <Text style={{ color: "#000", fontWeight: "700" }}>{submitLabel}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
