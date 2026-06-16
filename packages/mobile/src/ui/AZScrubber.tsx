import { useRef, useState } from "react";
import { type GestureResponderEvent, type LayoutChangeEvent, Text, View } from "react-native";
import { theme } from "./theme";

export function AZScrubber({
  letters,
  onScrubTo,
}: {
  letters: string[];
  onScrubTo: (letter: string) => void;
}) {
  const heightRef = useRef(0);
  const [active, setActive] = useState<string | null>(null);

  function pick(e: GestureResponderEvent) {
    if (letters.length === 0 || heightRef.current === 0) return;
    const y = e.nativeEvent.locationY;
    const idx = Math.min(
      letters.length - 1,
      Math.max(0, Math.floor((y / heightRef.current) * letters.length)),
    );
    const letter = letters[idx];
    if (letter && letter !== active) {
      setActive(letter);
      onScrubTo(letter);
    }
  }

  return (
    <View
      onLayout={(e: LayoutChangeEvent) => {
        heightRef.current = e.nativeEvent.layout.height;
      }}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderGrant={pick}
      onResponderMove={pick}
      onResponderRelease={() => setActive(null)}
      style={{
        position: "absolute",
        right: 0,
        top: 0,
        bottom: 0,
        width: 22,
        justifyContent: "space-between",
        alignItems: "center",
        paddingVertical: 8,
      }}
    >
      {letters.map((l) => (
        <Text key={l} style={{ fontSize: 9, color: l === active ? theme.accent : theme.textDim }}>
          {l}
        </Text>
      ))}
      {active ? (
        <View
          style={{
            position: "absolute",
            right: 30,
            top: "45%",
            width: 48,
            height: 48,
            borderRadius: 12,
            backgroundColor: theme.accent,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ color: "#000", fontWeight: "800", fontSize: 24 }}>{active}</Text>
        </View>
      ) : null}
    </View>
  );
}
