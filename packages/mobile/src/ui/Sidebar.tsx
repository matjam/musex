import type { Playlist } from "@musex/core";
import { listValidator } from "@musex/core";
import { useRouter } from "expo-router";
import { TabTrigger, type TabTriggerSlotProps } from "expo-router/ui";
import {
  Cog,
  Disc3,
  HardDriveDownload,
  Home,
  Library,
  ListMusic,
  type LucideIcon,
  Search,
} from "lucide-react-native";
import { forwardRef, useEffect, useState } from "react";
import { Pressable, type View as RNView, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useStore } from "../state/store";
import type { LayoutMode } from "./layout-mode";
import { theme } from "./theme";

// iPad sidebar (desktop mirror): labeled 220px column in landscape, 64px
// icon-only rail in portrait. Nav items are expo-router/ui TabTriggers used
// OUTSIDE TabList — the switch-trigger form (name only, no href): the
// installed expo-router only registers routes from TabTriggers inside the
// TabList, while outside ones resolve the name via TabTriggerMapContext and
// JUMP_TO the tab.
type SidebarItemProps = TabTriggerSlotProps & {
  icon: LucideIcon;
  label: string;
  expanded: boolean;
};

const SidebarItem = forwardRef<RNView, SidebarItemProps>(
  ({ icon: Icon, label, expanded, isFocused, ...props }, ref) => {
    const color = isFocused ? theme.accent : theme.textDim;
    return (
      <Pressable
        ref={ref}
        {...props}
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: expanded ? "flex-start" : "center",
          gap: expanded ? 12 : 0,
          paddingVertical: 10,
          paddingHorizontal: expanded ? theme.space(2) : 0,
        }}
      >
        <Icon color={color} size={22} />
        {expanded ? <Text style={{ color, fontSize: 14, fontWeight: "600" }}>{label}</Text> : null}
      </Pressable>
    );
  },
);
SidebarItem.displayName = "SidebarItem";

const NAV: { name: string; icon: LucideIcon; label: string }[] = [
  { name: "home", icon: Home, label: "Home" },
  { name: "search", icon: Search, label: "Search" },
  { name: "library", icon: Library, label: "Library" },
  { name: "settings", icon: Cog, label: "Settings" },
];

export function Sidebar({ mode }: { mode: Exclude<LayoutMode, "phone"> }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { state, gateway } = useStore();
  const expanded = mode === "pad-landscape";
  const [playlists, setPlaylists] = useState<Playlist[]>([]);

  // Playlists section (rendered in landscape only). Offline/uncached is
  // tolerated — any failure (incl. OfflineUnavailable) leaves the list empty.
  const library = state.library;
  const token = state.token;
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!library || !token) {
        setPlaylists([]);
        return;
      }
      try {
        const pls = await gateway.listPlaylists(library, token, listValidator(library.updatedAt));
        if (alive) setPlaylists(pls);
      } catch {
        if (alive) setPlaylists([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [library, token, gateway]);

  return (
    <View
      style={{
        width: expanded ? 220 : 64,
        backgroundColor: theme.surface,
        borderRightWidth: 1,
        borderRightColor: theme.border,
        paddingTop: insets.top + theme.space(1),
        paddingBottom: insets.bottom,
      }}
    >
      {/* Brand row */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: expanded ? "flex-start" : "center",
          paddingHorizontal: expanded ? theme.space(2) : 0,
          paddingVertical: theme.space(1),
        }}
      >
        {expanded ? (
          <Text style={{ color: theme.text, fontSize: 18, fontWeight: "800" }}>musex</Text>
        ) : (
          <Disc3 color={theme.accent} size={24} />
        )}
      </View>

      {/* Tab nav — switch-triggers (name only; the hidden TabList defines the routes) */}
      {NAV.map((item) => (
        <TabTrigger key={item.name} name={item.name} asChild>
          <SidebarItem icon={item.icon} label={item.label} expanded={expanded} />
        </TabTrigger>
      ))}

      {/* Downloaded — deep-link into the Library tab's Downloaded segment. The
          nonce makes re-taps re-trigger the segment effect even when the param
          value is unchanged. */}
      <Pressable
        onPress={() =>
          router.navigate({
            pathname: "/(tabs)/library",
            params: { segment: "Downloaded", segNonce: String(Date.now()) },
          })
        }
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: expanded ? "flex-start" : "center",
          gap: expanded ? 12 : 0,
          paddingVertical: 10,
          paddingHorizontal: expanded ? theme.space(2) : 0,
        }}
      >
        <HardDriveDownload color={theme.textDim} size={22} />
        {expanded ? (
          <Text style={{ color: theme.textDim, fontSize: 14, fontWeight: "600" }}>Downloaded</Text>
        ) : null}
      </Pressable>

      {/* Playlists (landscape only) */}
      {expanded && playlists.length > 0 ? (
        <>
          <Text
            style={{
              color: theme.textDim,
              fontSize: 11,
              fontWeight: "700",
              textTransform: "uppercase",
              paddingHorizontal: theme.space(2),
              paddingTop: theme.space(2),
              paddingBottom: 4,
            }}
          >
            Playlists
          </Text>
          <ScrollView style={{ flex: 1 }}>
            {playlists.map((p) => (
              <Pressable
                key={p.id}
                onPress={() =>
                  router.push({
                    pathname: "/(tabs)/home/playlist",
                    params: {
                      id: p.id,
                      serverId: p.serverId,
                      updatedAt: p.updatedAt ?? "",
                      trackCount: p.trackCount ?? "",
                    },
                  })
                }
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 10,
                  paddingVertical: 8,
                  paddingHorizontal: theme.space(2),
                }}
              >
                <ListMusic color={theme.textDim} size={16} />
                <Text numberOfLines={1} style={{ color: theme.text, fontSize: 13, flex: 1 }}>
                  {p.title}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </>
      ) : null}
    </View>
  );
}
