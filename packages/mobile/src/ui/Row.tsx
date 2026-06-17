import { Check } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";
import { theme } from "./theme";

export function Row({
  title,
  subtitle,
  selected = false,
  onPress,
}: {
  title: string;
  subtitle?: string;
  selected?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingHorizontal: theme.space(2),
        paddingVertical: theme.space(1.5),
        borderBottomWidth: 1,
        borderBottomColor: theme.border,
      }}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ color: theme.text, fontSize: 16 }}>{title}</Text>
        {subtitle ? <Text style={{ color: theme.textDim, fontSize: 13 }}>{subtitle}</Text> : null}
      </View>
      {selected ? <Check color={theme.accent} size={20} /> : null}
    </Pressable>
  );
}
