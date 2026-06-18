import { useEffect, useState } from "react";
import {
  Alert,
  Linking,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useStore } from "../../../src/state/store";
import { theme } from "../../../src/ui/theme";

export default function LastfmSettings() {
  const { getLastfmConfig, setLastfmConfig, connectLastfm, disconnectLastfm, setLastfmSecret } =
    useStore();

  const cfg = getLastfmConfig();

  const [apiKey, setApiKey] = useState(cfg.apiKey);
  const [secret, setSecret] = useState("");
  const [connecting, setConnecting] = useState(false);
  // Mirror of the displayed connection status/username — updated after connect/disconnect
  // so the row reflects the new state without waiting for a re-render from the store.
  const [connectionStatus, setConnectionStatus] = useState({
    connection: cfg.connection,
    username: cfg.username,
  });

  // Sync local apiKey state if cfg changes (e.g. on first load).
  useEffect(() => {
    setApiKey(cfg.apiKey);
  }, [cfg.apiKey]);

  async function handleConnect() {
    if (!apiKey.trim()) {
      Alert.alert("Last.fm", "Enter your API key first.");
      return;
    }
    if (!secret.trim()) {
      Alert.alert("Last.fm", "Enter your API secret first.");
      return;
    }
    setConnecting(true);
    try {
      // Persist the key + secret before connecting.
      await setLastfmConfig({ ...cfg, apiKey: apiKey.trim() });
      await setLastfmSecret(secret.trim());
      const result = await connectLastfm();
      const fresh = getLastfmConfig();
      setConnectionStatus({ connection: fresh.connection, username: fresh.username });
      Alert.alert("Last.fm", result.message);
    } finally {
      setConnecting(false);
    }
  }

  async function handleDisconnect() {
    await disconnectLastfm();
    const fresh = getLastfmConfig();
    setConnectionStatus({ connection: fresh.connection, username: fresh.username });
  }

  const isConnected = Boolean(connectionStatus.username);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: theme.bg }}>
      <Text
        style={{
          color: theme.textDim,
          fontSize: 12,
          textTransform: "uppercase",
          paddingHorizontal: theme.space(2),
          paddingTop: theme.space(2),
          paddingBottom: 6,
        }}
      >
        Status
      </Text>
      <View
        style={{
          backgroundColor: theme.surface,
          borderRadius: 10,
          paddingHorizontal: theme.space(2),
          paddingVertical: theme.space(1.5),
          marginHorizontal: theme.space(2),
          marginBottom: theme.space(2),
          borderWidth: 1,
          borderColor: theme.border,
        }}
      >
        <Text style={{ color: theme.text, fontSize: 15 }}>{connectionStatus.connection}</Text>
        {connectionStatus.username ? (
          <Text style={{ color: theme.textDim, fontSize: 13, marginTop: 2 }}>
            Signed in as {connectionStatus.username}
          </Text>
        ) : null}
      </View>

      {!isConnected ? (
        <>
          <Text
            style={{
              color: theme.textDim,
              fontSize: 12,
              textTransform: "uppercase",
              paddingHorizontal: theme.space(2),
              paddingTop: theme.space(1),
              paddingBottom: 6,
            }}
          >
            Credentials
          </Text>
          <View
            style={{
              backgroundColor: theme.surface,
              borderRadius: 10,
              marginHorizontal: theme.space(2),
              marginBottom: theme.space(1),
              borderWidth: 1,
              borderColor: theme.border,
              overflow: "hidden",
            }}
          >
            <TextInput
              value={apiKey}
              onChangeText={setApiKey}
              placeholder="API Key"
              placeholderTextColor={theme.textDim}
              autoCapitalize="none"
              autoCorrect={false}
              style={{
                color: theme.text,
                fontSize: 15,
                paddingHorizontal: theme.space(2),
                paddingVertical: theme.space(1.5),
                borderBottomWidth: 1,
                borderBottomColor: theme.border,
              }}
            />
            <TextInput
              value={secret}
              onChangeText={setSecret}
              placeholder="API Secret"
              placeholderTextColor={theme.textDim}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              style={{
                color: theme.text,
                fontSize: 15,
                paddingHorizontal: theme.space(2),
                paddingVertical: theme.space(1.5),
              }}
            />
          </View>

          <TouchableOpacity
            onPress={() => void handleConnect()}
            disabled={connecting}
            style={{
              backgroundColor: connecting ? theme.border : theme.accent,
              borderRadius: 10,
              padding: theme.space(2),
              marginHorizontal: theme.space(2),
              marginTop: theme.space(1),
              marginBottom: theme.space(2),
              alignItems: "center",
            }}
          >
            <Text style={{ color: "#fff", fontSize: 16, fontWeight: "600" }}>
              {connecting ? "Connecting…" : "Connect"}
            </Text>
          </TouchableOpacity>
        </>
      ) : (
        <TouchableOpacity
          onPress={() => void handleDisconnect()}
          style={{
            backgroundColor: theme.surface,
            borderRadius: 10,
            padding: theme.space(2),
            borderWidth: 1,
            borderColor: theme.border,
            marginHorizontal: theme.space(2),
            marginBottom: theme.space(2),
            alignItems: "center",
          }}
        >
          <Text style={{ color: "#ff6b6b", fontSize: 16 }}>Disconnect</Text>
        </TouchableOpacity>
      )}

      <Text
        style={{
          color: theme.textDim,
          fontSize: 12,
          textTransform: "uppercase",
          paddingHorizontal: theme.space(2),
          paddingTop: theme.space(1),
          paddingBottom: 6,
        }}
      >
        Options
      </Text>
      <View
        style={{
          backgroundColor: theme.surface,
          borderRadius: 10,
          marginHorizontal: theme.space(2),
          borderWidth: 1,
          borderColor: theme.border,
          overflow: "hidden",
        }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            paddingHorizontal: theme.space(2),
            paddingVertical: theme.space(1.5),
            borderBottomWidth: 1,
            borderBottomColor: theme.border,
          }}
        >
          <View style={{ flex: 1 }}>
            <Text style={{ color: theme.text, fontSize: 15 }}>Scrobbling</Text>
            <Text style={{ color: theme.textDim, fontSize: 12 }}>Submit tracks you listen to</Text>
          </View>
          <Switch
            value={cfg.scrobbling}
            onValueChange={(v) => void setLastfmConfig({ ...cfg, scrobbling: v })}
            thumbColor={cfg.scrobbling ? theme.accent : theme.textDim}
            trackColor={{ true: `${theme.accent}88`, false: theme.border }}
          />
        </View>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            paddingHorizontal: theme.space(2),
            paddingVertical: theme.space(1.5),
          }}
        >
          <View style={{ flex: 1 }}>
            <Text style={{ color: theme.text, fontSize: 15 }}>Love on rating</Text>
            <Text style={{ color: theme.textDim, fontSize: 12 }}>
              Love tracks rated 4★ or above
            </Text>
          </View>
          <Switch
            value={cfg.loveOnRating}
            onValueChange={(v) => void setLastfmConfig({ ...cfg, loveOnRating: v })}
            thumbColor={cfg.loveOnRating ? theme.accent : theme.textDim}
            trackColor={{ true: `${theme.accent}88`, false: theme.border }}
          />
        </View>
      </View>
      <Pressable
        onPress={() => void Linking.openURL("https://www.last.fm/api/account/create")}
        hitSlop={8}
      >
        <Text
          style={{
            color: theme.accent,
            fontSize: 12,
            paddingHorizontal: theme.space(2),
            paddingTop: theme.space(1),
            paddingBottom: theme.space(3),
          }}
        >
          Get your API credentials at last.fm/api/account/create
        </Text>
      </Pressable>
    </ScrollView>
  );
}
