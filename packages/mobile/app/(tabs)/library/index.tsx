import type { Album, Artist, Track, TrackAlbumGroup } from "@musex/core";
import {
  buildLetterIndex,
  downloadKey,
  groupTracksByAlbum,
  isInFlight,
  listValidator,
  OfflineUnavailable,
} from "@musex/core";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { Trash2 } from "lucide-react-native";
import type { RefObject } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ViewToken } from "react-native";
import { ActivityIndicator, FlatList, Pressable, Text, View } from "react-native";
import { artUrl } from "../../../src/logic/art-url";
import { useStore } from "../../../src/state/store";
import { useRecordsProgress } from "../../../src/state/use-download-progress";
import { ActionBar } from "../../../src/ui/ActionBar";
import { AlbumArt } from "../../../src/ui/AlbumArt";
import { AZScrubber } from "../../../src/ui/AZScrubber";
import { DownloadProgressBar } from "../../../src/ui/DownloadProgressBar";
import { gridColumns } from "../../../src/ui/grid-columns";
import { SegmentedControl } from "../../../src/ui/SegmentedControl";
import { Tile } from "../../../src/ui/Tile";
import { theme } from "../../../src/ui/theme";

type Segment = "Artists" | "Albums" | "Tracks" | "Downloaded";
type Item =
  | { kind: "artist"; data: Artist }
  | { kind: "album"; data: Album }
  | { kind: "track"; data: Track };

const TRACK_ROW_H = 64; // fixed track-row height so scrollToIndex is exact

// Best-effort scroll restore across column-count changes (rotation). A
// numColumns change requires the key remount (RN can't change numColumns in
// place), which resets scroll — so track the first visible ITEM index and,
// after the remount, scroll back to its row under the new column count.
// RN requires viewabilityConfig/onViewableItemsChanged to be STABLE refs
// (changing them on the fly throws), hence the useRef wrappers; the current
// column count reaches the stable callback through colsRef.
function useColumnScrollRestore<T>(
  listRef: RefObject<FlatList<T> | null>,
  numCols: number,
  resetKey: string,
) {
  const firstVisibleItem = useRef(0);
  const colsRef = useRef(numCols);
  colsRef.current = numCols;
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 10 }).current;
  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const first = viewableItems[0];
    // With numColumns > 1 FlatList virtualizes by ROW, so viewable indices
    // are row indices — convert to an item index.
    if (first?.index != null) firstVisibleItem.current = first.index * colsRef.current;
  }).current;
  const prev = useRef({ cols: numCols, key: resetKey });
  useEffect(() => {
    const p = prev.current;
    prev.current = { cols: numCols, key: resetKey };
    if (p.key !== resetKey) {
      // Different dataset (segment switch) — start at the top, no restore.
      firstVisibleItem.current = 0;
      return;
    }
    if (p.cols === numCols) return;
    const row = Math.floor(firstVisibleItem.current / numCols);
    if (row <= 0) return;
    // Defer past the key remount so the new list instance exists and has laid
    // out; a bad index lands in the list's onScrollToIndexFailed fallback.
    const t = setTimeout(() => {
      listRef.current?.scrollToIndex({ index: row, animated: false });
    }, 0);
    return () => clearTimeout(t);
  }, [numCols, resetKey, listRef]);
  return { viewabilityConfig, onViewableItemsChanged };
}

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
    downloadsVersion,
    removeDownload,
  } = useStore();
  const router = useRouter();
  // Content-pane width (measured — on iPad the sidebar shrinks the pane, so
  // the window width would oversize tiles). null until onLayout delivers a
  // width: rendering nothing for one frame beats seeding from the WINDOW width
  // (which includes the sidebar → wrong column count → key-remount flash).
  const [paneWidth, setPaneWidth] = useState<number | null>(null);
  const [segment, setSegment] = useState<Segment>("Artists");
  // Deep-link target segment (iPad sidebar "Downloaded"): `segNonce` changes on
  // every tap so re-taps re-trigger even when the segment value is unchanged.
  const params = useLocalSearchParams<{ segment?: string; segNonce?: string }>();
  // biome-ignore lint/correctness/useExhaustiveDependencies: segNonce is a deliberate re-trigger, not referenced in the body.
  useEffect(() => {
    const seg = params.segment;
    if (seg === "Artists" || seg === "Albums" || seg === "Tracks" || seg === "Downloaded") {
      setSegment(seg);
    }
  }, [params.segment, params.segNonce]);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  // Set when an offline fetch found nothing cached (distinct from a generic
  // error, which keeps the prior items).
  const [offlineEmpty, setOfflineEmpty] = useState(false);
  const listRef = useRef<FlatList<Item>>(null);
  const dlListRef = useRef<FlatList<TrackAlbumGroup>>(null);
  // Downloaded segment state: track-grouped albums (re-baked thumbs).
  const [dlTrackGroups, setDlTrackGroups] = useState<TrackAlbumGroup[]>([]);

  // Tracks render as single-column rows; artists/albums/downloaded as a tile
  // grid whose column count derives from the pane width (2 on phone, more on iPad).
  // Fallback 0 is never rendered — the lists mount only once paneWidth is measured.
  const gridCols = gridColumns(paneWidth ?? 0);
  const numCols = segment === "Tracks" ? 1 : gridCols;
  const tileSize = ((paneWidth ?? 0) - 22) / gridCols; // 22 = scrubber gutter

  // Restore scroll position across rotation-driven column changes.
  const mainRestore = useColumnScrollRestore(listRef, numCols, segment);
  const dlRestore = useColumnScrollRestore(dlListRef, gridCols, "downloaded");

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
        const validator = listValidator(state.library.updatedAt);
        try {
          let next: Item[];
          if (segment === "Artists") {
            next = (await gateway.listArtists(state.library, state.token, validator)).map((d) => ({
              kind: "artist",
              data: d,
            }));
          } else if (segment === "Albums") {
            next = (
              await gateway.listAllAlbums(state.library, "title", state.token, validator)
            ).map((d) => ({
              kind: "album",
              data: d,
            }));
          } else {
            next = (
              await gateway.listAllTracks(state.library, "title", state.token, validator)
            ).map((d) => ({
              kind: "track",
              data: d,
            }));
          }
          if (alive) {
            setItems(next);
            setOfflineEmpty(false);
            setLoading(false);
          }
        } catch (err) {
          if (err instanceof OfflineUnavailable) {
            // Offline and this segment was never cached — show the offline state.
            if (alive) {
              setItems([]);
              setOfflineEmpty(true);
              setLoading(false);
            }
          } else {
            // Non-fatal: keep the existing items on a background-refresh failure.
            if (alive) setLoading(false);
          }
        }
      })();
      return () => {
        alive = false;
      };
    }, [segment, state.library, state.token, gateway, items.length]),
  );

  // Refresh the Downloaded segment tiles. Stable via useCallback so the effect dep is safe.
  const refreshDownloads = useCallback(() => {
    // Group re-baked tracks (from downloadedTracks) for correct tile art.
    setDlTrackGroups(groupTracksByAlbum(downloadedTracks()));
  }, [downloadedTracks]);

  // Refresh tiles on segment entry and as tracks land — every progress event
  // bumps downloadsVersion (throttled in the store), so no poll is needed.
  // biome-ignore lint/correctness/useExhaustiveDependencies: downloadsVersion is a deliberate refresh trigger, not referenced in the body.
  useEffect(() => {
    if (segment === "Downloaded") refreshDownloads();
  }, [downloadsVersion, segment, refreshDownloads]);

  // Whole-collection progress for the Downloaded header bar ("n/total tracks")
  // + header gating (inFlight > 0), recomputed per downloadsVersion bump.
  const wholeProgress = useRecordsProgress();
  // Albums with in-flight records (tile downloading badge).
  // biome-ignore lint/correctness/useExhaustiveDependencies: downloadsVersion is a deliberate refresh trigger, not referenced in the body.
  const downloadingAlbumIds = useMemo(() => {
    const ids = new Set<string>();
    for (const r of downloadsList()) if (isInFlight(r)) ids.add(r.meta.albumId);
    return ids;
  }, [downloadsList, downloadsVersion]);

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
    try {
      return await gateway.listAllTracks(
        state.library,
        "title",
        state.token,
        listValidator(state.library.updatedAt),
      );
    } catch {
      // Offline / not cached — the action bar simply has nothing to play.
      return [];
    }
  }

  return (
    <View
      style={{ flex: 1, backgroundColor: theme.bg }}
      onLayout={(e) => setPaneWidth(e.nativeEvent.layout.width)}
    >
      <SegmentedControl
        segments={["Artists", "Albums", "Tracks", "Downloaded"]}
        value={segment}
        onChange={(s) => setSegment(s as Segment)}
      />
      {paneWidth === null ? null : segment === "Downloaded" ? (
        <FlatList
          ref={dlListRef}
          key={`downloaded-${gridCols}`}
          data={dlTrackGroups}
          numColumns={gridCols}
          keyExtractor={(g) => g.albumId}
          viewabilityConfig={dlRestore.viewabilityConfig}
          onViewableItemsChanged={dlRestore.onViewableItemsChanged}
          onScrollToIndexFailed={(info) => {
            dlListRef.current?.scrollToOffset({
              offset: info.averageItemLength * info.index,
              animated: false,
            });
          }}
          ListHeaderComponent={
            <View>
              {wholeProgress.inFlight > 0 ? (
                <View
                  style={{
                    backgroundColor: theme.surface,
                    borderBottomWidth: 1,
                    borderBottomColor: theme.border,
                  }}
                >
                  <DownloadProgressBar progress={wholeProgress} />
                </View>
              ) : null}
              {dlTrackGroups.length > 0 ? (
                <ActionBar session={session} getTracks={() => downloadedTracks()} />
              ) : null}
            </View>
          }
          ListEmptyComponent={
            wholeProgress.inFlight === 0 ? (
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
                  <View>
                    <AlbumArt url={art} size={tileSize - 12} />
                    {downloadingAlbumIds.has(group.albumId) ? (
                      <View
                        style={{
                          position: "absolute",
                          top: 6,
                          right: 6,
                          backgroundColor: "#000a",
                          borderRadius: 12,
                          padding: 4,
                        }}
                      >
                        <ActivityIndicator size="small" color={theme.accent} />
                      </View>
                    ) : null}
                  </View>
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
      ) : offlineEmpty ? (
        <View style={{ flex: 1, alignItems: "center", paddingTop: theme.space(6) }}>
          <Text style={{ color: theme.textDim, fontSize: 15, textAlign: "center" }}>
            Not available offline.{"\n"}Connect to Plex to browse this list.
          </Text>
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          <FlatList
            ref={listRef}
            key={`${segment}-${numCols}`}
            data={items}
            numColumns={numCols}
            keyExtractor={(it, i) => `${it.kind}-${it.data.id}-${i}`}
            viewabilityConfig={mainRestore.viewabilityConfig}
            onViewableItemsChanged={mainRestore.onViewableItemsChanged}
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
                        params: { artistId: item.data.id, updatedAt: item.data.updatedAt ?? "" },
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
                        params: { albumId: item.data.id, updatedAt: item.data.updatedAt ?? "" },
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
