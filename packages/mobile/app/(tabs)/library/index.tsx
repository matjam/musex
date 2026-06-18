import type { Album, Artist, DownloadAlbumGroup, Track } from "@musex/core";
import { buildLetterIndex, groupDownloadsByAlbum } from "@musex/core";
import { useRouter } from "expo-router";
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
  // Downloaded segment state: album groups + active-strip records
  const [dlGroups, setDlGroups] = useState<DownloadAlbumGroup[]>([]);
  const [activeKeys, setActiveKeys] = useState<string[]>([]);
  const dlPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Tracks render as single-column rows; artists/albums/downloaded as a 2-col tile grid.
  const numCols = segment === "Tracks" ? 1 : 2;
  const tileSize = (width - 22) / 2; // 22 = scrubber gutter

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

  // Refresh the Downloaded segment. Stable via useCallback so the effect dep is safe.
  const refreshDownloads = useCallback(() => {
    const records = downloadsList();
    setDlGroups(groupDownloadsByAlbum(records));
    const inFlight = records.filter((r) => r.state === "queued" || r.state === "downloading");
    setActiveKeys(inFlight.map((r) => r.key));
    return inFlight.length > 0;
  }, [downloadsList]);

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
          data={dlGroups}
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
              {dlGroups.length > 0 ? (
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
                    const albumTracks = downloadedTracks().filter(
                      (t) => t.albumId === group.albumId,
                    );
                    if (albumTracks.length) void playTracks(albumTracks, 0);
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
                    for (const key of group.keys) void removeDownload(key);
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
