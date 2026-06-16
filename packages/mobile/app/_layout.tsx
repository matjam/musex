import { Stack } from "expo-router";
import { StatusBar } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StoreProvider } from "../src/state/store";
import { theme } from "../src/ui/theme";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StoreProvider>
        <StatusBar barStyle="light-content" />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.bg } }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="sign-in" />
          <Stack.Screen name="picker" options={{ headerShown: true, title: "Choose library" }} />
          <Stack.Screen name="now-playing" options={{ presentation: "modal" }} />
        </Stack>
      </StoreProvider>
    </SafeAreaProvider>
  );
}
