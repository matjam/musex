import { rating10FromStars, starsFromRating10 } from "@musex/core";
import { Star } from "lucide-react-native";
import { Pressable, View } from "react-native";
import { theme } from "./theme";

export function StarRating({
  rating10,
  onRate,
  size = 18,
}: {
  /** Current Plex 0–10 rating (null = unrated). */
  rating10: number | null;
  /** New 0–10 rating, or null to clear. */
  onRate: (rating10: number | null) => void;
  size?: number;
}) {
  const current = starsFromRating10(rating10);
  return (
    <View style={{ flexDirection: "row", gap: 6 }}>
      {[1, 2, 3, 4, 5].map((n) => {
        const filled = n <= current;
        return (
          <Pressable
            key={n}
            hitSlop={6}
            onPress={() => onRate(n === current ? null : rating10FromStars(n))}
          >
            <Star
              size={size}
              color={filled ? theme.accent : theme.textDim}
              fill={filled ? theme.accent : "transparent"}
            />
          </Pressable>
        );
      })}
    </View>
  );
}
