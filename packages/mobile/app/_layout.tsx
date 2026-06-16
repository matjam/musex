import { Stack } from "expo-router";
import { StatusBar, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StoreProvider } from "../src/state/store";
import { MiniPlayer } from "../src/ui/MiniPlayer";
import { theme } from "../src/ui/theme";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StoreProvider>
        <StatusBar barStyle="light-content" />
        <View style={{ flex: 1, backgroundColor: theme.bg }}>
          <View style={{ flex: 1 }}>
            <Stack
              screenOptions={{
                headerStyle: { backgroundColor: theme.surface },
                headerTintColor: theme.text,
                contentStyle: { backgroundColor: theme.bg },
              }}
            />
          </View>
          <SafeAreaView edges={["bottom"]} style={{ backgroundColor: theme.surface }}>
            <MiniPlayer />
          </SafeAreaView>
        </View>
      </StoreProvider>
    </SafeAreaProvider>
  );
}
