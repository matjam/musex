import { Stack } from "expo-router";
import { theme } from "../../../src/ui/theme";

export default function HomeLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: theme.surface },
        headerTintColor: theme.text,
        contentStyle: { backgroundColor: theme.bg },
      }}
    >
      <Stack.Screen name="index" options={{ title: "Home" }} />
      <Stack.Screen name="mix" options={{ title: "" }} />
      <Stack.Screen name="playlist" options={{ title: "" }} />
    </Stack>
  );
}
