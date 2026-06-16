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
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: theme.surface },
            headerTintColor: theme.text,
            contentStyle: { backgroundColor: theme.bg },
          }}
        />
      </StoreProvider>
    </SafeAreaProvider>
  );
}
