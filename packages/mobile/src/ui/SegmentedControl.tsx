import { Pressable, Text, View } from "react-native";
import { theme } from "./theme";

export function SegmentedControl({
  segments,
  value,
  onChange,
}: {
  segments: string[];
  value: string;
  onChange: (s: string) => void;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        backgroundColor: theme.surface,
        borderRadius: 8,
        padding: 2,
        margin: theme.space(1.5),
      }}
    >
      {segments.map((s) => {
        const on = s === value;
        return (
          <Pressable
            key={s}
            onPress={() => onChange(s)}
            style={{
              flex: 1,
              paddingVertical: 7,
              borderRadius: 6,
              backgroundColor: on ? theme.border : "transparent",
              alignItems: "center",
            }}
          >
            <Text style={{ color: on ? theme.text : theme.textDim, fontSize: 13 }}>{s}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
