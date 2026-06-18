import { Stack } from "expo-router";
import { theme } from "../../../src/ui/theme";

export default function SearchLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: theme.surface },
        headerTintColor: theme.text,
        contentStyle: { backgroundColor: theme.bg },
      }}
    >
      <Stack.Screen name="index" options={{ title: "Search" }} />
      <Stack.Screen name="genre" options={{ title: "Genre" }} />
      <Stack.Screen name="mix" options={{ title: "Mix" }} />
    </Stack>
  );
}
