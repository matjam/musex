import { TabList, TabSlot, Tabs, TabTrigger, type TabTriggerSlotProps } from "expo-router/ui";
import { Cog, Library, type LucideIcon } from "lucide-react-native";
import { forwardRef } from "react";
import { Pressable, type View as RNView, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MiniPlayer } from "../../src/ui/MiniPlayer";
import { theme } from "../../src/ui/theme";

// SDK 56: expo-router dropped react-navigation, so the tab bar is built with
// expo-router/ui's headless Tabs (TabSlot = content, TabList = the bar). The
// mini-player is a plain sibling rendered above the bar.
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
  return (
    <Tabs>
      <TabSlot />
      <MiniPlayer />
      <SafeAreaView edges={["bottom"]} style={{ backgroundColor: theme.surface }}>
        <TabList
          style={{
            backgroundColor: theme.surface,
            borderTopWidth: 1,
            borderTopColor: theme.border,
          }}
        >
          <TabTrigger name="library" href="/(tabs)/library" asChild>
            <TabButton icon={Library} label="Library" />
          </TabTrigger>
          <TabTrigger name="settings" href="/(tabs)/settings" asChild>
            <TabButton icon={Cog} label="Settings" />
          </TabTrigger>
        </TabList>
      </SafeAreaView>
    </Tabs>
  );
}
