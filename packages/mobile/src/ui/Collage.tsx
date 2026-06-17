import { View } from "react-native";
import { AlbumArt } from "./AlbumArt";

/** A 2x2 grid of album art baked from up to four image URLs. Fewer than four
 *  (or nulls) render as placeholders, so it always fills the square. */
export function Collage({ urls, size }: { urls: (string | null)[]; size: number }) {
  const cell = size / 2;
  const four: (string | null)[] = [
    urls[0] ?? null,
    urls[1] ?? null,
    urls[2] ?? null,
    urls[3] ?? null,
  ];
  return (
    <View
      style={{
        width: size,
        height: size,
        flexDirection: "row",
        flexWrap: "wrap",
        borderRadius: 8,
        overflow: "hidden",
      }}
    >
      {four.map((u, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: fixed 4-slot positional grid
        <AlbumArt key={i} url={u} size={cell} />
      ))}
    </View>
  );
}
