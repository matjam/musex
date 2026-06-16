import type { Pin } from "@musex/core";
import { useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Linking, Pressable, Text, View } from "react-native";
import { useStore } from "../src/state/store";
import { theme } from "../src/ui/theme";

export default function SignIn() {
  const { gateway, tokenStore, dispatch } = useStore();
  const router = useRouter();
  const [pin, setPin] = useState<Pin | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const p = await gateway.createPin();
      setPin(p);
      await Linking.openURL(p.authUrl);
      // Poll until the token appears (cap ~2 min).
      for (let i = 0; i < 60; i++) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const { authToken } = await gateway.pollPin(p.id);
        if (authToken) {
          await tokenStore.save(authToken);
          const servers = await gateway.listServers(authToken);
          dispatch({ type: "signed-in", token: authToken, servers });
          router.replace("/picker");
          return;
        }
      }
      setError("Sign-in timed out. Try again.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        padding: theme.space(3),
        backgroundColor: theme.bg,
      }}
    >
      <Text
        style={{ color: theme.text, fontSize: 28, fontWeight: "700", marginBottom: theme.space(2) }}
      >
        musex
      </Text>
      <Text style={{ color: theme.textDim, textAlign: "center", marginBottom: theme.space(4) }}>
        Sign in with your Plex account to stream your library.
      </Text>
      {pin ? (
        <Text style={{ color: theme.text, fontSize: 18, marginBottom: theme.space(2) }}>
          Code: {pin.code}
        </Text>
      ) : null}
      <Pressable
        onPress={start}
        disabled={busy}
        style={{
          backgroundColor: theme.accent,
          paddingHorizontal: theme.space(4),
          paddingVertical: theme.space(2),
          borderRadius: 999,
          opacity: busy ? 0.6 : 1,
        }}
      >
        {busy ? (
          <ActivityIndicator color="#000" />
        ) : (
          <Text style={{ fontWeight: "700" }}>Sign in with Plex</Text>
        )}
      </Pressable>
      {error ? <Text style={{ color: "#ff6b6b", marginTop: theme.space(2) }}>{error}</Text> : null}
    </View>
  );
}
