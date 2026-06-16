import { Pressable, Text } from "react-native";
import { theme } from "./theme";

export function Row({
  title,
  subtitle,
  onPress,
}: {
  title: string;
  subtitle?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        paddingHorizontal: theme.space(2),
        paddingVertical: theme.space(1.5),
        borderBottomWidth: 1,
        borderBottomColor: theme.border,
      }}
    >
      <Text style={{ color: theme.text, fontSize: 16 }}>{title}</Text>
      {subtitle ? <Text style={{ color: theme.textDim, fontSize: 13 }}>{subtitle}</Text> : null}
    </Pressable>
  );
}
