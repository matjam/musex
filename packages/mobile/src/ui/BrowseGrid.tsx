import {
  type Album,
  composeMoodMix,
  type GenreEntry,
  genreIndex,
  listValidator,
  MOOD_MIXES,
  sampleThumbs,
  type Track,
  tracksForGenre,
} from "@musex/core";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import { artUrl } from "../logic/art-url";
import { useStore } from "../state/store";
import { Collage } from "./Collage";
import { gridColumns } from "./grid-columns";
import { theme } from "./theme";

type Cell =
  | { kind: "mood"; key: string; label: string; thumbs: string[] }
  | { kind: "genre"; key: string; label: string; thumbs: string[] };

export function BrowseGrid() {
  const { gateway, token, artBaseFor, taste } = useStore();
  const library = useStore().state.library;
  const router = useRouter();
  // Pane width measured on the container (iPad's sidebar shrinks the pane, so
  // the window width would oversize tiles). null until onLayout delivers a
  // width: rendering nothing for one frame beats seeding from the WINDOW width
  // (which includes the sidebar → wrong column count → key-remount flash).
  const [paneWidth, setPaneWidth] = useState<number | null>(null);
  const [cells, setCells] = useState<Cell[]>([]);

  // Pane-width-derived columns. No scrubber, so use the full width minus outer
  // padding (6px each side). Fallback 0 is never rendered — the list mounts
  // only once paneWidth is measured.
  const cols = gridColumns(paneWidth ?? 0);
  const tileSize = ((paneWidth ?? 0) - 12) / cols;

  useEffect(() => {
    if (!library || !token) return;
    let alive = true;
    (async () => {
      let albums: Album[] = [];
      let allTracks: Track[] = [];
      try {
        const validator = listValidator(library.updatedAt);
        [albums, allTracks] = await Promise.all([
          gateway.listAllAlbums(library, "title", token, validator),
          gateway.listAllTracks(library, "title", token, validator),
        ]);
      } catch {
        // leave empty — cells will have no art (also the offline path)
      }

      if (!alive) return;

      const snap = taste.snapshot();
      const statsMap = new Map(
        snap.trackStats.map((s) => [
          s.key,
          { plays: s.plays, skips: s.skips, ratingStars: s.ratingStars },
        ]),
      );
      const topArtists = snap.topArtists;

      const serverId = library.serverId;
      const base = artBaseFor(serverId);

      function bakeUrls(thumbs: string[]): string[] {
        if (!base || !token) return [];
        return thumbs.map((t) => artUrl(base, t, token)).filter((u): u is string => u !== null);
      }

      const moodCells: Cell[] = MOOD_MIXES.map((mix) => {
        const tracks = composeMoodMix(mix, albums, allTracks, statsMap, topArtists);
        const rawThumbs = tracks.map((t) => t.thumb).filter((t): t is string => !!t);
        const sampled = sampleThumbs(rawThumbs, 4, mix.id);
        return { kind: "mood", key: mix.id, label: mix.title, thumbs: bakeUrls(sampled) };
      });

      const genres: GenreEntry[] = genreIndex(albums);
      const genreCells: Cell[] = genres.map((g) => {
        const tracks = tracksForGenre(g.genre, albums, allTracks);
        const rawThumbs = tracks.map((t) => t.thumb).filter((t): t is string => !!t);
        const sampled = sampleThumbs(rawThumbs, 4, g.genre);
        return { kind: "genre", key: g.genre, label: g.genre, thumbs: bakeUrls(sampled) };
      });

      if (alive) setCells([...moodCells, ...genreCells]);
    })();
    return () => {
      alive = false;
    };
  }, [library, token, gateway, taste, artBaseFor]);

  // No scroll restore across the key remount here (unlike library/index.tsx):
  // the browse list is short, so losing scroll on rotation is not worth the
  // viewability-tracking machinery.
  return (
    <View style={{ flex: 1 }} onLayout={(e) => setPaneWidth(e.nativeEvent.layout.width)}>
      {paneWidth === null ? null : (
        <FlatList
          key={cols}
          data={cells}
          numColumns={cols}
          keyExtractor={(c) => `${c.kind}:${c.key}`}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: 6 }}
          renderItem={({ item }) => (
            <Pressable
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
              style={{ width: tileSize, padding: 6 }}
            >
              <Collage urls={item.thumbs.slice(0, 4)} size={tileSize - 12} />
              <Text
                numberOfLines={2}
                style={{
                  color: theme.text,
                  fontSize: 13,
                  fontWeight: "600",
                  marginTop: 6,
                }}
              >
                {item.label}
              </Text>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}
