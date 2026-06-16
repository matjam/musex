import { BottomTabBar, type BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { Tabs } from "expo-router";
import { Cog, Library } from "lucide-react-native";
import { View } from "react-native";
import { MiniPlayer } from "../../src/ui/MiniPlayer";
import { theme } from "../../src/ui/theme";

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.accent,
        tabBarInactiveTintColor: theme.textDim,
        tabBarStyle: { backgroundColor: theme.surface, borderTopColor: theme.border },
        sceneStyle: { backgroundColor: theme.bg },
      }}
      tabBar={(props) => (
        <View style={{ backgroundColor: theme.surface }}>
          <MiniPlayer />
          {/* expo-router's tabBar props are type-compatible at runtime but differ
              slightly from @react-navigation/bottom-tabs in TypeScript due to
              ColorValue vs string in nested header options. Cast is safe. */}
          <BottomTabBar {...(props as unknown as BottomTabBarProps)} />
        </View>
      )}
    >
      <Tabs.Screen
        name="library"
        options={{
          title: "Library",
          tabBarIcon: ({ color, size }) => <Library color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarIcon: ({ color, size }) => <Cog color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}
