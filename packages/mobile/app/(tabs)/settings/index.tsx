import Constants from "expo-constants";
import { useRouter } from "expo-router";
import { Pressable, ScrollView, Text } from "react-native";
import { clearSelectedLibrary } from "../../../src/adapters/selected-library-store";
import { useStore } from "../../../src/state/store";
import { Row } from "../../../src/ui/Row";
import { theme } from "../../../src/ui/theme";

const APP_VERSION = Constants.expoConfig?.version ?? "0.0.1";

export default function SettingsIndex() {
  const { state, tokenStore, dispatch, getLastfmConfig, clearListCache } = useStore();
  const router = useRouter();
  const lfmCfg = getLastfmConfig();

  async function signOut() {
    await tokenStore.clear();
    await clearSelectedLibrary();
    await clearListCache();
    dispatch({ type: "signed-out" });
    router.replace("/sign-in");
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: theme.bg }}>
      <Text
        style={{
          color: theme.textDim,
          fontSize: 12,
          textTransform: "uppercase",
          paddingHorizontal: theme.space(2),
          paddingTop: theme.space(2),
          paddingBottom: 6,
        }}
      >
        Library
      </Text>
      <Row
        title={state.library?.title ?? "—"}
        subtitle={state.library?.serverName ?? "Tap to choose"}
        onPress={() => router.push("/(tabs)/settings/library")}
      />

      <Text
        style={{
          color: theme.textDim,
          fontSize: 12,
          textTransform: "uppercase",
          paddingHorizontal: theme.space(2),
          paddingTop: theme.space(2),
          paddingBottom: 6,
        }}
      >
        Storage
      </Text>
      <Row
        title="Downloads & Storage"
        subtitle="Quality, size, remove all"
        onPress={() => router.push("/(tabs)/settings/downloads")}
      />

      <Text
        style={{
          color: theme.textDim,
          fontSize: 12,
          textTransform: "uppercase",
          paddingHorizontal: theme.space(2),
          paddingTop: theme.space(2),
          paddingBottom: 6,
        }}
      >
        Integrations
      </Text>
      <Row
        title="Last.fm"
        subtitle={lfmCfg.connection}
        onPress={() => router.push("/(tabs)/settings/lastfm")}
      />

      <Pressable
        onPress={signOut}
        style={{
          backgroundColor: theme.surface,
          borderRadius: 10,
          padding: theme.space(2),
          borderWidth: 1,
          borderColor: theme.border,
          margin: theme.space(2),
        }}
      >
        <Text style={{ color: "#ff6b6b", fontSize: 16 }}>Sign out</Text>
      </Pressable>

      <Text style={{ color: theme.textDim, fontSize: 12, paddingHorizontal: theme.space(2) }}>
        musex {APP_VERSION}
      </Text>
    </ScrollView>
  );
}
