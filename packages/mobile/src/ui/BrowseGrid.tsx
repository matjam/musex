import { type GenreEntry, genreIndex, MOOD_MIXES } from "@musex/core";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { FlatList, useWindowDimensions } from "react-native";
import { useStore } from "../state/store";
import { Tile } from "./Tile";

type Cell =
  | { kind: "mood"; key: string; label: string }
  | { kind: "genre"; key: string; label: string };

export function BrowseGrid() {
  const { gateway, token } = useStore();
  const library = useStore().state.library;
  const router = useRouter();
  const { width } = useWindowDimensions();
  const [genres, setGenres] = useState<GenreEntry[]>([]);

  // Tile width: 2 columns with 6px padding on each tile side = 12px per tile,
  // plus a 12px outer margin on each side of the list = total gutter per col 24px.
  // Mirror library/index.tsx: tileSize = (width - 22) / 2 (22 = scrubber gutter there).
  // Here there is no scrubber so use (width - 12) / 2 (12px = left+right outer padding).
  const tileSize = (width - 12) / 2;

  useEffect(() => {
    if (!library || !token) return;
    let alive = true;
    gateway
      .listAllAlbums(library, "title", token)
      .then((albums) => {
        if (alive) setGenres(genreIndex(albums));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [library, token, gateway]);

  const cells: Cell[] = [
    ...MOOD_MIXES.map((m) => ({ kind: "mood" as const, key: m.id, label: m.title })),
    ...genres.map((g) => ({ kind: "genre" as const, key: g.genre, label: g.genre })),
  ];

  return (
    <FlatList
      data={cells}
      numColumns={2}
      keyExtractor={(c) => `${c.kind}:${c.key}`}
      contentContainerStyle={{ paddingHorizontal: 6 }}
      renderItem={({ item }) => (
        <Tile
          art={null}
          size={tileSize}
          label={item.label}
          onPress={() =>
            item.kind === "mood"
              ? router.push({
                  pathname: "/(tabs)/search/mix",
                  params: { mood: item.key },
                } as never)
              : router.push({
                  pathname: "/(tabs)/search/genre",
                  params: { genre: item.key },
                } as never)
          }
        />
      )}
    />
  );
}
