import { Stack } from "expo-router";
import { theme } from "../../../src/ui/theme";

export default function LibraryLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: theme.surface },
        headerTintColor: theme.text,
        contentStyle: { backgroundColor: theme.bg },
      }}
    >
      <Stack.Screen name="index" options={{ title: "Artists" }} />
      <Stack.Screen name="albums" options={{ title: "Albums" }} />
      <Stack.Screen name="tracks" options={{ title: "Tracks" }} />
    </Stack>
  );
}
