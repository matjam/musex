import { Redirect } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { useStore } from "../src/state/store";
import { theme } from "../src/ui/theme";

export default function Index() {
  const { state } = useStore();
  if (state.phase === "loading") {
    return (
      <View style={{ flex: 1, justifyContent: "center", backgroundColor: theme.bg }}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }
  return <Redirect href={state.phase === "signed-in" ? "/picker" : "/sign-in"} />;
}
