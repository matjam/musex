import Constants from "expo-constants";
import { useRouter } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { useStore } from "../../src/state/store";
import { theme } from "../../src/ui/theme";

const APP_VERSION = Constants.expoConfig?.version ?? "0.0.1";

export default function Settings() {
  const { state, tokenStore, dispatch } = useStore();
  const router = useRouter();

  async function signOut() {
    await tokenStore.clear();
    dispatch({ type: "signed-out" });
    router.replace("/sign-in");
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, padding: theme.space(2) }}>
      <Text
        style={{ color: theme.textDim, fontSize: 12, textTransform: "uppercase", marginBottom: 6 }}
      >
        Library
      </Text>
      <Text style={{ color: theme.text, fontSize: 16 }}>{state.library?.title ?? "—"}</Text>
      <Text style={{ color: theme.textDim, fontSize: 13, marginBottom: theme.space(3) }}>
        {state.library?.serverName ?? ""}
      </Text>

      <Pressable
        onPress={signOut}
        style={{
          backgroundColor: theme.surface,
          borderRadius: 10,
          padding: theme.space(2),
          borderWidth: 1,
          borderColor: theme.border,
        }}
      >
        <Text style={{ color: "#ff6b6b", fontSize: 16 }}>Sign out</Text>
      </Pressable>

      <Text style={{ color: theme.textDim, fontSize: 12, marginTop: theme.space(3) }}>
        musex {APP_VERSION}
      </Text>
    </View>
  );
}
