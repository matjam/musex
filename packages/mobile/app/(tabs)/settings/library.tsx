import type { Library } from "@musex/core";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Text, View } from "react-native";
import { useStore } from "../../../src/state/store";
import { Row } from "../../../src/ui/Row";
import { theme } from "../../../src/ui/theme";

export default function LibrarySwitcher() {
  const { state, listAllLibraries, selectLibrary } = useStore();
  const router = useRouter();
  const [libs, setLibs] = useState<Library[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const all = await listAllLibraries();
        const sorted = all
          .slice()
          .sort((a, b) => Number(Boolean(b.owned)) - Number(Boolean(a.owned)));
        if (alive) setLibs(sorted);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [listAllLibraries]);

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: "center", backgroundColor: theme.bg }}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }

  if (libs.length === 0) {
    return (
      <View style={{ flex: 1, justifyContent: "center", backgroundColor: theme.bg }}>
        <Text style={{ color: theme.textDim, textAlign: "center" }}>No libraries found.</Text>
      </View>
    );
  }

  return (
    <FlatList
      style={{ flex: 1, backgroundColor: theme.bg }}
      data={libs}
      keyExtractor={(l) => `${l.serverId}-${l.id}`}
      renderItem={({ item }) => (
        <Row
          title={item.title}
          subtitle={
            item.owned
              ? item.serverName
              : `${item.serverName} · shared by ${item.sourceTitle ?? "someone"}`
          }
          selected={item.id === state.library?.id && item.serverId === state.library?.serverId}
          onPress={async () => {
            await selectLibrary(item);
            router.back();
          }}
        />
      )}
    />
  );
}
