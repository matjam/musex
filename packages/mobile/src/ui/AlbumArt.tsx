import { Image } from "expo-image";
import { View } from "react-native";
import { theme } from "./theme";

export function AlbumArt({
  url,
  size,
  circular = false,
}: {
  url: string | null;
  size: number;
  circular?: boolean;
}) {
  const radius = circular ? size / 2 : Math.max(4, size * 0.08);
  if (!url) {
    return (
      <View
        style={{ width: size, height: size, borderRadius: radius, backgroundColor: theme.border }}
      />
    );
  }
  return (
    <Image
      source={{ uri: url }}
      style={{ width: size, height: size, borderRadius: radius, backgroundColor: theme.border }}
      contentFit="cover"
      transition={150}
    />
  );
}
