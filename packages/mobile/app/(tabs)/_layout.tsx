import { TabList, TabSlot, Tabs, TabTrigger, type TabTriggerSlotProps } from "expo-router/ui";
import { Cog, Home, Library, type LucideIcon, Search, WifiOff } from "lucide-react-native";
import { forwardRef } from "react";
import { Pressable, type View as RNView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useStore } from "../../src/state/store";
import { MiniPlayer } from "../../src/ui/MiniPlayer";
import { theme } from "../../src/ui/theme";

// SDK 56: expo-router dropped react-navigation, so the tab bar is built with
// expo-router/ui's headless Tabs (TabSlot = content, TabList = the bar). TabList
// MUST be a direct child of Tabs — the navigator scans direct children for it,
// so it cannot be wrapped (e.g. in a SafeAreaView). The mini-player is a plain
// sibling rendered above the bar; the bottom safe-area inset is applied as
// padding on TabList instead of a wrapper.
type TabButtonProps = TabTriggerSlotProps & { icon: LucideIcon; label: string };

const TabButton = forwardRef<RNView, TabButtonProps>(
  ({ icon: Icon, label, isFocused, ...props }, ref) => {
    const color = isFocused ? theme.accent : theme.textDim;
    return (
      <Pressable
        ref={ref}
        {...props}
        style={{ flex: 1, alignItems: "center", paddingVertical: 8, gap: 2 }}
      >
        <Icon color={color} size={22} />
        <Text style={{ color, fontSize: 11 }}>{label}</Text>
      </Pressable>
    );
  },
);
TabButton.displayName = "TabButton";

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const { connectivity } = useStore();
  return (
    <Tabs>
      <TabSlot />
      {connectivity === "offline" ? (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            backgroundColor: "#8b1a1a",
            paddingVertical: 6,
          }}
        >
          <WifiOff color="#fff" size={14} />
          <Text style={{ color: "#fff", fontSize: 12, fontWeight: "600" }}>
            Offline · playing downloaded music
          </Text>
        </View>
      ) : null}
      <MiniPlayer />
      <TabList
        style={{
          backgroundColor: theme.surface,
          borderTopWidth: 1,
          borderTopColor: theme.border,
          paddingBottom: insets.bottom,
        }}
      >
        <TabTrigger name="home" href="/(tabs)/home" asChild>
          <TabButton icon={Home} label="Home" />
        </TabTrigger>
        <TabTrigger name="search" href="/(tabs)/search" asChild>
          <TabButton icon={Search} label="Search" />
        </TabTrigger>
        <TabTrigger name="library" href="/(tabs)/library" asChild>
          <TabButton icon={Library} label="Library" />
        </TabTrigger>
        <TabTrigger name="settings" href="/(tabs)/settings" asChild>
          <TabButton icon={Cog} label="Settings" />
        </TabTrigger>
      </TabList>
    </Tabs>
  );
}
