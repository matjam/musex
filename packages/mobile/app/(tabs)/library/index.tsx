import type { Album, Artist, Track } from "@musex/core";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, useWindowDimensions, View } from "react-native";
import { artUrl } from "../../../src/logic/art-url";
import { buildLetterIndex } from "../../../src/logic/az-index";
import { useStore } from "../../../src/state/store";
import { AZScrubber } from "../../../src/ui/AZScrubber";
import { SegmentedControl } from "../../../src/ui/SegmentedControl";
import { Tile } from "../../../src/ui/Tile";
import { theme } from "../../../src/ui/theme";

type Segment = "Artists" | "Albums" | "Tracks";
type Item =
  | { kind: "artist"; data: Artist }
  | { kind: "album"; data: Album }
  | { kind: "track"; data: Track };

export default function LibraryBrowse() {
  const { state, gateway, artBaseFor, token, playTracks } = useStore();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const [segment, setSegment] = useState<Segment>("Artists");
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const listRef = useRef<FlatList<Item>>(null);

  const tileSize = (width - 22) / 2; // 22 = scrubber gutter
  const ROW_H = tileSize + 36; // art + labels + padding

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!state.library || !state.token) return;
      setLoading(true);
      let next: Item[] = [];
      if (segment === "Artists") {
        next = (await gateway.listArtists(state.library, state.token)).map((d) => ({
          kind: "artist",
          data: d,
        }));
      } else if (segment === "Albums") {
        next = (await gateway.listAllAlbums(state.library, "title", state.token)).map((d) => ({
          kind: "album",
          data: d,
        }));
      } else {
        next = (await gateway.listAllTracks(state.library, "title", state.token)).map((d) => ({
          kind: "track",
          data: d,
        }));
      }
      if (alive) {
        setItems(next);
        setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [segment, state.library, state.token, gateway]);

  const { letters, indexOf } = useMemo(
    () =>
      buildLetterIndex(items, (it: Item) => (it.kind === "artist" ? it.data.name : it.data.title)),
    [items],
  );

  function scrubTo(letter: string) {
    const idx = indexOf[letter];
    if (idx == null) return;
    // A numColumns FlatList scrolls by ROW, so an item index can exceed the row
    // count and make scrollToIndex throw "out of range". Convert item -> row and
    // use scrollToOffset (pixel-based, never out of range).
    listRef.current?.scrollToOffset({ offset: Math.floor(idx / 2) * ROW_H, animated: false });
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <SegmentedControl
        segments={["Artists", "Albums", "Tracks"]}
        value={segment}
        onChange={(s) => setSegment(s as Segment)}
      />
      {loading ? (
        <View style={{ flex: 1, justifyContent: "center" }}>
          <ActivityIndicator color={theme.accent} />
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          <FlatList
            ref={listRef}
            data={items}
            numColumns={2}
            keyExtractor={(it, i) => `${it.kind}-${it.data.id}-${i}`}
            renderItem={({ item }) => {
              const base = artBaseFor(item.data.serverId);
              const art = base && token ? artUrl(base, item.data.thumb, token) : null;
              if (item.kind === "artist") {
                return (
                  <Tile
                    art={art}
                    size={tileSize}
                    label={item.data.name}
                    circular
                    onPress={() =>
                      router.push({
                        pathname: "/(tabs)/library/albums",
                        params: { artistId: item.data.id },
                      })
                    }
                  />
                );
              }
              if (item.kind === "album") {
                return (
                  <Tile
                    art={art}
                    size={tileSize}
                    label={item.data.title}
                    onPress={() =>
                      router.push({
                        pathname: "/(tabs)/library/tracks",
                        params: { albumId: item.data.id },
                      })
                    }
                  />
                );
              }
              return (
                <Tile
                  art={art}
                  size={tileSize}
                  label={item.data.title}
                  sublabel={item.data.artistName}
                  onPress={() => void playTracks([item.data], 0)}
                />
              );
            }}
          />
          <AZScrubber letters={letters} onScrubTo={scrubTo} />
        </View>
      )}
    </View>
  );
}
