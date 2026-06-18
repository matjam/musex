import { Stack } from "expo-router";
import { theme } from "../../../src/ui/theme";

export default function SettingsLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: theme.surface },
        headerTintColor: theme.text,
        contentStyle: { backgroundColor: theme.bg },
      }}
    >
      <Stack.Screen name="index" options={{ title: "Settings" }} />
      <Stack.Screen name="library" options={{ title: "Library" }} />
      <Stack.Screen name="lastfm" options={{ title: "Last.fm" }} />
      <Stack.Screen name="downloads" options={{ title: "Downloads & Storage" }} />
      <Stack.Screen name="plugins" options={{ title: "Plugins" }} />
    </Stack>
  );
}
