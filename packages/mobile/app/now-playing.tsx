import { Text, View } from "react-native";
import { theme } from "../src/ui/theme";

export default function NowPlaying() {
  return (
    <View
      style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: theme.bg }}
    >
      <Text style={{ color: theme.text }}>Now Playing</Text>
    </View>
  );
}
