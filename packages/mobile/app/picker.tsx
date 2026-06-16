import type { Library, Server } from "@musex/core";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, View } from "react-native";
import { useStore } from "../src/state/store";
import { Row } from "../src/ui/Row";
import { theme } from "../src/ui/theme";

export default function Picker() {
  const { state, gateway, dispatch } = useStore();
  const router = useRouter();
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [loading, setLoading] = useState(true);

  async function loadLibraries(server: Server) {
    if (!state.token) return;
    setLoading(true);
    const libs = await gateway.listMusicLibraries(server, state.token);
    setLibraries(libs);
    setLoading(false);
    const only = libs[0];
    if (libs.length === 1 && only) {
      dispatch({ type: "library-selected", library: only });
      router.replace("/(tabs)/library");
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: run once per server set
  useEffect(() => {
    const only = state.servers[0];
    if (state.servers.length === 1 && only) {
      void loadLibraries(only);
    } else {
      setLoading(false);
    }
  }, [state.servers]);

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: "center", backgroundColor: theme.bg }}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }

  // Multi-server: pick a server first, then its library list.
  if (state.servers.length > 1 && libraries.length === 0) {
    return (
      <FlatList
        style={{ backgroundColor: theme.bg }}
        data={state.servers}
        keyExtractor={(s) => s.id}
        renderItem={({ item }) => (
          <Row title={item.name} onPress={() => void loadLibraries(item)} />
        )}
      />
    );
  }

  return (
    <FlatList
      style={{ backgroundColor: theme.bg }}
      data={libraries}
      keyExtractor={(l) => l.id}
      renderItem={({ item }) => (
        <Row
          title={item.title}
          subtitle={item.serverName}
          onPress={() => {
            dispatch({ type: "library-selected", library: item });
            router.push("/(tabs)/library");
          }}
        />
      )}
    />
  );
}
