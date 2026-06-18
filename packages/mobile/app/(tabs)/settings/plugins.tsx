import type { BridgeRegState } from "@musex/plugin-host";
import { CircleAlert, PackageSearch, Plug, RefreshCw, Trash2, WifiOff } from "lucide-react-native";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import type { AvailablePlugin, FetchManifestResult } from "../../../src/plugins/plugin-installer";
import type { PluginListItem } from "../../../src/plugins/plugin-manager";
import { useStore } from "../../../src/state/store";
import { theme } from "../../../src/ui/theme";

/** A short human summary of what a plugin registered into the hub. */
function registeredSummary(reg: BridgeRegState | null): string {
  if (!reg) return "nothing registered";
  const parts: string[] = [];
  if (reg.acquisition) parts.push("acquisition");
  if (reg.recommender) parts.push("radio");
  if (reg.similar.length) parts.push(`similar: ${reg.similar.join(", ")}`);
  const sectionCount = Object.keys(reg.sections).length;
  if (sectionCount) parts.push(`${sectionCount} section${sectionCount > 1 ? "s" : ""}`);
  if (reg.trackActions.length)
    parts.push(`${reg.trackActions.length} track action${reg.trackActions.length > 1 ? "s" : ""}`);
  if (reg.trackDetail.length)
    parts.push(`${reg.trackDetail.length} detail panel${reg.trackDetail.length > 1 ? "s" : ""}`);
  if (reg.eventHandlers.length)
    parts.push(
      `${reg.eventHandlers.length} event handler${reg.eventHandlers.length > 1 ? "s" : ""}`,
    );
  return parts.length ? parts.join(" · ") : "nothing registered";
}

function statusColor(status: PluginListItem["status"]): string {
  if (status === "active") return theme.accent;
  if (status === "error") return "#e5534b";
  return theme.textDim;
}

function SectionHeader({ title }: { title: string }) {
  return (
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
      {title}
    </Text>
  );
}

export default function PluginsSettings() {
  const { plugins, connectivity } = useStore();
  const offline = connectivity === "offline";

  // Installed list snapshot; bumped after any mutation so the UI re-reads list().
  const [, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);
  const installed = plugins.list();

  const [repoUrl, setRepoUrl] = useState("");
  const [fetching, setFetching] = useState(false);
  const [available, setAvailable] = useState<FetchManifestResult | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleFetch() {
    if (!repoUrl.trim() || offline) return;
    setFetching(true);
    setAvailable(null);
    try {
      const result = await plugins.fetchManifest(repoUrl.trim());
      setAvailable(result);
    } catch (err) {
      Alert.alert("Couldn't read repository", err instanceof Error ? err.message : String(err));
    } finally {
      setFetching(false);
    }
  }

  function confirmInstall(p: AvailablePlugin) {
    if (!p.compatible) {
      Alert.alert(
        "Incompatible plugin",
        `${p.name} targets a different plugin API version and can't be installed.`,
      );
      return;
    }
    Alert.alert(
      `Install ${p.name}?`,
      "Plugins run in a sandbox but are granted full access to the plugin API — your library searches, listening history, network, and stored secrets. Only install plugins you trust.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Install",
          onPress: async () => {
            setBusy(true);
            try {
              await plugins.install(repoUrl.trim(), p.id);
              refresh();
            } catch (err) {
              Alert.alert("Install failed", err instanceof Error ? err.message : String(err));
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  }

  function confirmRemove(p: PluginListItem) {
    Alert.alert(`Remove ${p.name}?`, "This deletes the plugin from this device.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          setBusy(true);
          try {
            await plugins.uninstall(p.id);
            refresh();
          } catch (err) {
            Alert.alert("Remove failed", err instanceof Error ? err.message : String(err));
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  }

  async function handleToggle(p: PluginListItem, v: boolean) {
    setBusy(true);
    try {
      await plugins.setEnabled(p.id, v);
      refresh();
    } catch (err) {
      Alert.alert("Couldn't update plugin", err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleReload() {
    setBusy(true);
    try {
      await plugins.reload();
      refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: theme.bg }}>
      <SectionHeader title="Installed" />
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
        {installed.length === 0 ? (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
              padding: theme.space(2),
            }}
          >
            <Plug color={theme.textDim} size={18} />
            <Text style={{ color: theme.textDim, fontSize: 14, flex: 1 }}>
              No plugins installed. Add one from a GitHub repository below.
            </Text>
          </View>
        ) : (
          installed.map((p, i) => (
            <View
              key={p.id}
              style={{
                paddingHorizontal: theme.space(2),
                paddingVertical: theme.space(1.5),
                borderTopWidth: i === 0 ? 0 : 1,
                borderTopColor: theme.border,
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.text, fontSize: 15 }}>
                    {p.name}{" "}
                    <Text style={{ color: theme.textDim, fontSize: 12 }}>v{p.version}</Text>
                  </Text>
                  <Text style={{ color: statusColor(p.status), fontSize: 12, marginTop: 2 }}>
                    {p.status === "loading" ? "loading…" : p.status}
                    {p.status === "active" ? ` — ${registeredSummary(p.registered)}` : ""}
                  </Text>
                  {p.error ? (
                    <View
                      style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 }}
                    >
                      <CircleAlert color="#e5534b" size={12} />
                      <Text style={{ color: "#e5534b", fontSize: 12, flex: 1 }}>{p.error}</Text>
                    </View>
                  ) : null}
                </View>
                <Switch
                  value={p.enabled}
                  disabled={busy}
                  onValueChange={(v) => void handleToggle(p, v)}
                  thumbColor={p.enabled ? theme.accent : theme.textDim}
                  trackColor={{ true: `${theme.accent}88`, false: theme.border }}
                />
                <Pressable onPress={() => confirmRemove(p)} hitSlop={8} disabled={busy}>
                  <Trash2 color="#e5534b" size={18} />
                </Pressable>
              </View>
            </View>
          ))
        )}
      </View>

      <Pressable
        onPress={() => void handleReload()}
        disabled={busy}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          paddingHorizontal: theme.space(2),
          paddingVertical: theme.space(1),
          marginBottom: theme.space(2),
        }}
        hitSlop={8}
      >
        <RefreshCw color={theme.accent} size={16} />
        <Text style={{ color: theme.accent, fontSize: 14 }}>Reload plugins</Text>
      </Pressable>

      <SectionHeader title="Add from GitHub" />
      {offline ? (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            marginHorizontal: theme.space(2),
            marginBottom: theme.space(2),
            padding: theme.space(2),
            backgroundColor: theme.surface,
            borderRadius: 10,
            borderWidth: 1,
            borderColor: theme.border,
          }}
        >
          <WifiOff color={theme.textDim} size={18} />
          <Text style={{ color: theme.textDim, fontSize: 14, flex: 1 }}>
            You're offline. Reconnect to add or update plugins.
          </Text>
        </View>
      ) : (
        <>
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
            <TextInput
              value={repoUrl}
              onChangeText={setRepoUrl}
              placeholder="https://github.com/owner/repo"
              placeholderTextColor={theme.textDim}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              style={{
                color: theme.text,
                fontSize: 15,
                paddingHorizontal: theme.space(2),
                paddingVertical: theme.space(1.5),
              }}
            />
          </View>
          <Pressable
            onPress={() => void handleFetch()}
            disabled={fetching || !repoUrl.trim()}
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              backgroundColor: fetching || !repoUrl.trim() ? theme.border : theme.accent,
              borderRadius: 10,
              padding: theme.space(2),
              marginHorizontal: theme.space(2),
              marginTop: theme.space(1),
            }}
          >
            {fetching ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <PackageSearch color="#fff" size={18} />
            )}
            <Text style={{ color: "#fff", fontSize: 16, fontWeight: "600" }}>
              {fetching ? "Reading…" : "Find plugins"}
            </Text>
          </Pressable>

          {available ? (
            <View
              style={{
                backgroundColor: theme.surface,
                borderRadius: 10,
                marginHorizontal: theme.space(2),
                marginTop: theme.space(2),
                borderWidth: 1,
                borderColor: theme.border,
                overflow: "hidden",
              }}
            >
              <Text
                style={{
                  color: theme.textDim,
                  fontSize: 12,
                  paddingHorizontal: theme.space(2),
                  paddingTop: theme.space(1.5),
                }}
              >
                {available.repo}
              </Text>
              {available.plugins.length === 0 ? (
                <Text
                  style={{
                    color: theme.textDim,
                    fontSize: 14,
                    padding: theme.space(2),
                  }}
                >
                  No plugins found in this repository.
                </Text>
              ) : (
                available.plugins.map((p) => (
                  <Pressable
                    key={p.id}
                    onPress={() => confirmInstall(p)}
                    disabled={busy || !p.compatible}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 10,
                      paddingHorizontal: theme.space(2),
                      paddingVertical: theme.space(1.5),
                      borderTopWidth: 1,
                      borderTopColor: theme.border,
                      opacity: p.compatible ? 1 : 0.5,
                    }}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: theme.text, fontSize: 15 }}>
                        {p.name}{" "}
                        <Text style={{ color: theme.textDim, fontSize: 12 }}>v{p.version}</Text>
                      </Text>
                      {p.description ? (
                        <Text style={{ color: theme.textDim, fontSize: 12 }} numberOfLines={2}>
                          {p.description}
                        </Text>
                      ) : null}
                      <Text style={{ color: theme.textDim, fontSize: 12, marginTop: 2 }}>
                        {!p.compatible
                          ? "Incompatible API version"
                          : p.installedVersion
                            ? p.installedVersion === p.version
                              ? "Installed"
                              : `Update from v${p.installedVersion}`
                            : "Tap to install"}
                      </Text>
                    </View>
                  </Pressable>
                ))
              )}
            </View>
          ) : null}
        </>
      )}

      <Text
        style={{
          color: theme.textDim,
          fontSize: 12,
          paddingHorizontal: theme.space(2),
          paddingTop: theme.space(2),
          paddingBottom: theme.space(3),
        }}
      >
        Plugins run sandboxed but are trusted with the full plugin API. Only install plugins from
        sources you trust.
      </Text>
    </ScrollView>
  );
}
