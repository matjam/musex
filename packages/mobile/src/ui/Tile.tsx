import { Pressable, Text, View } from "react-native";
import { AlbumArt } from "./AlbumArt";
import { theme } from "./theme";

export function Tile({
  art,
  size,
  label,
  sublabel,
  circular = false,
  onPress,
}: {
  art: string | null;
  size: number;
  label: string;
  sublabel?: string;
  circular?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={{ width: size, padding: 6 }}>
      <View style={{ alignItems: circular ? "center" : "stretch" }}>
        <AlbumArt url={art} size={size - 12} circular={circular} />
      </View>
      <Text numberOfLines={1} style={{ color: theme.text, fontSize: 13, marginTop: 6 }}>
        {label}
      </Text>
      {sublabel ? (
        <Text numberOfLines={1} style={{ color: theme.textDim, fontSize: 11 }}>
          {sublabel}
        </Text>
      ) : null}
    </Pressable>
  );
}
