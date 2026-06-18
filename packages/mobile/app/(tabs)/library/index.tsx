import type { Album, Artist, Track, TrackAlbumGroup } from "@musex/core";
import { buildLetterIndex, downloadKey, groupTracksByAlbum } from "@musex/core";
import { useFocusEffect, useRouter } from "expo-router";
import { Trash2 } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { artUrl } from "../../../src/logic/art-url";
import { useStore } from "../../../src/state/store";
import { ActionBar } from "../../../src/ui/ActionBar";
import { AlbumArt } from "../../../src/ui/AlbumArt";
import { AZScrubber } from "../../../src/ui/AZScrubber";
import { SegmentedControl } from "../../../src/ui/SegmentedControl";
import { Tile } from "../../../src/ui/Tile";
import { theme } from "../../../src/ui/theme";

type Segment = "Artists" | "Albums" | "Tracks" | "Downloaded";
type Item =
  | { kind: "artist"; data: Artist }
  | { kind: "album"; data: Album }
  | { kind: "track"; data: Track };

const TRACK_ROW_H = 64; // fixed track-row height so scrollToIndex is exact

export default function LibraryBrowse() {
  const {
    state,
    gateway,
    session,
    artBaseFor,
    token,
    playTracks,
    downloadedTracks,
    downloadsList,
    removeDownload,
  } = useStore();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const [segment, setSegment] = useState<Segment>("Artists");
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const listRef = useRef<FlatList<Item>>(null);
  // Downloaded segment state: track-grouped albums (re-baked thumbs) + active-strip keys
  const [dlTrackGroups, setDlTrackGroups] = useState<TrackAlbumGroup[]>([]);
  const [activeKeys, setActiveKeys] = useState<string[]>([]);
  const dlPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Tracks render as single-column rows; artists/albums/downloaded as a 2-col tile grid.
  const numCols = segment === "Tracks" ? 1 : 2;
  const tileSize = (width - 22) / 2; // 22 = scrubber gutter

  // Refetch whenever the Library tab gains focus so newly-added Plex tracks
  // appear without an app restart. On a focus-triggered refresh when items are
  // already loaded, skip the spinner (background refresh, no flicker).
  useFocusEffect(
    useCallback(() => {
      if (segment === "Downloaded") return;
      let alive = true;
      (async () => {
        if (!state.library || !state.token) return;
        // Show spinner only on first load (no data yet).
        if (items.length === 0) setLoading(true);
        let next: Item[] = [];
        try {
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
        } catch {
          // Non-fatal: keep the existing items on a background-refresh failure.
        }
        if (alive) {
          setItems(next);
          setLoading(false);
        }
      })();
      return () => {
        alive = false;
      };
    }, [segment, state.library, state.token, gateway, items.length]),
  );

  // Refresh the Downloaded segment. Stable via useCallback so the effect dep is safe.
  const refreshDownloads = useCallback(() => {
    const records = downloadsList();
    // Group re-baked tracks (from downloadedTracks) for correct tile art.
    setDlTrackGroups(groupTracksByAlbum(downloadedTracks()));
    const inFlight = records.filter((r) => r.state === "queued" || r.state === "downloading");
    setActiveKeys(inFlight.map((r) => r.key));
    return inFlight.length > 0;
  }, [downloadsList, downloadedTracks]);

  useEffect(() => {
    if (segment !== "Downloaded") {
      if (dlPollRef.current) {
        clearInterval(dlPollRef.current);
        dlPollRef.current = null;
      }
      return;
    }
    // Initial load
    const hasInFlight = refreshDownloads();
    if (hasInFlight) {
      dlPollRef.current = setInterval(() => {
        const still = refreshDownloads();
        if (!still && dlPollRef.current) {
          clearInterval(dlPollRef.current);
          dlPollRef.current = null;
        }
      }, 1000);
    }
    return () => {
      if (dlPollRef.current) {
        clearInterval(dlPollRef.current);
        dlPollRef.current = null;
      }
    };
  }, [segment, refreshDownloads]);

  const { letters, indexOf } = useMemo(
    () =>
      buildLetterIndex(items, (it: Item) => (it.kind === "artist" ? it.data.name : it.data.title)),
    [items],
  );

  function scrubTo(letter: string) {
    const idx = indexOf[letter];
    if (idx == null) return;
    // FlatList scrolls by ROW; convert the item index to its row (idx/cols).
    listRef.current?.scrollToIndex({
      index: Math.floor(idx / numCols),
      viewPosition: 0,
      animated: false,
    });
  }

  // Whole-library tracks for the top action bar ("shuffle all"). On the Tracks
  // segment the tracks are already loaded; otherwise fetch them.
  async function allLibraryTracks(): Promise<Track[]> {
    if (segment === "Tracks") {
      return items.flatMap((it) => (it.kind === "track" ? [it.data] : []));
    }
    if (!state.library || !state.token) return [];
    return gateway.listAllTracks(state.library, "title", state.token);
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <SegmentedControl
        segments={["Artists", "Albums", "Tracks", "Downloaded"]}
        value={segment}
        onChange={(s) => setSegment(s as Segment)}
      />
      {segment === "Downloaded" ? (
        <FlatList
          key="downloaded"
          data={dlTrackGroups}
          numColumns={2}
          keyExtractor={(g) => g.albumId}
          ListHeaderComponent={
            <View>
              {activeKeys.length > 0 ? (
                <View
                  style={{
                    backgroundColor: theme.surface,
                    paddingHorizontal: theme.space(2),
                    paddingVertical: theme.space(1),
                    borderBottomWidth: 1,
                    borderBottomColor: theme.border,
                  }}
                >
                  <Text style={{ color: theme.textDim, fontSize: 12 }}>
                    Downloading {activeKeys.length} track{activeKeys.length !== 1 ? "s" : ""}…
                  </Text>
                </View>
              ) : null}
              {dlTrackGroups.length > 0 ? (
                <ActionBar session={session} getTracks={() => downloadedTracks()} />
              ) : null}
            </View>
          }
          ListEmptyComponent={
            activeKeys.length === 0 ? (
              <View style={{ flex: 1, alignItems: "center", paddingTop: theme.space(6) }}>
                <Text style={{ color: theme.textDim, fontSize: 15 }}>No downloads yet.</Text>
              </View>
            ) : null
          }
          renderItem={({ item: group }) => {
            const art = group.thumb ?? null;
            return (
              <View style={{ width: tileSize, padding: 6 }}>
                <Pressable
                  onPress={() => {
                    if (group.tracks.length) void playTracks(group.tracks, 0);
                  }}
                >
                  <AlbumArt url={art} size={tileSize - 12} />
                  <Text numberOfLines={1} style={{ color: theme.text, fontSize: 13, marginTop: 6 }}>
                    {group.albumTitle}
                  </Text>
                  <Text numberOfLines={1} style={{ color: theme.textDim, fontSize: 11 }}>
                    {group.artistName}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    for (const t of group.tracks) {
                      void removeDownload(downloadKey(t.serverId, t.media.partKey));
                    }
                  }}
                  hitSlop={8}
                  style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 }}
                >
                  <Trash2 color={theme.textDim} size={12} />
                  <Text style={{ color: theme.textDim, fontSize: 11 }}>Remove</Text>
                </Pressable>
              </View>
            );
          }}
        />
      ) : loading ? (
        <View style={{ flex: 1, justifyContent: "center" }}>
          <ActivityIndicator color={theme.accent} />
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          <FlatList
            ref={listRef}
            key={segment}
            data={items}
            numColumns={numCols}
            keyExtractor={(it, i) => `${it.kind}-${it.data.id}-${i}`}
            ListHeaderComponent={<ActionBar session={session} getTracks={allLibraryTracks} />}
            getItemLayout={
              numCols === 1
                ? (_d, index) => ({ length: TRACK_ROW_H, offset: TRACK_ROW_H * index, index })
                : undefined
            }
            onScrollToIndexFailed={(info) => {
              listRef.current?.scrollToOffset({
                offset: info.averageItemLength * info.index,
                animated: false,
              });
            }}
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
              const sub = [item.data.albumTitle, item.data.artistName].filter(Boolean).join(" · ");
              return (
                <Pressable
                  onPress={() => void playTracks([item.data], 0)}
                  style={{
                    height: TRACK_ROW_H,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 12,
                    paddingHorizontal: theme.space(2),
                    borderBottomWidth: 1,
                    borderBottomColor: theme.border,
                  }}
                >
                  <AlbumArt url={art} size={48} />
                  <View style={{ flex: 1 }}>
                    <Text numberOfLines={1} style={{ color: theme.text, fontSize: 15 }}>
                      {item.data.title}
                    </Text>
                    {sub ? (
                      <Text numberOfLines={1} style={{ color: theme.textDim, fontSize: 12 }}>
                        {sub}
                      </Text>
                    ) : null}
                  </View>
                </Pressable>
              );
            }}
          />
          <AZScrubber letters={letters} onScrubTo={scrubTo} />
        </View>
      )}
    </View>
  );
}
