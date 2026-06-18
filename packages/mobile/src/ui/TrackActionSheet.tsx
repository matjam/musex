import { buildDownloadLookup, downloadKey, downloadRecordFor, type Track } from "@musex/core";
import { useRouter } from "expo-router";
import {
  CircleCheck,
  Disc3,
  Download,
  ListEnd,
  ListPlus,
  ListStart,
  Mic,
  Radio,
  Trash2,
} from "lucide-react-native";
import { useEffect, useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import { artUrl } from "../logic/art-url";
import { useStore } from "../state/store";
import { AddToPlaylistSheet } from "./AddToPlaylistSheet";
import { AlbumArt } from "./AlbumArt";
import { StarRating } from "./StarRating";
import { theme } from "./theme";

export function TrackActionSheet({
  track,
  visible,
  onClose,
  playlistContext,
  onRemovedFromPlaylist,
}: {
  track: Track | null;
  visible: boolean;
  onClose: () => void;
  /** Present when opened from inside a playlist → enables "Remove from this playlist". */
  playlistContext?: { playlistId: string; playlistItemId: string };
  onRemovedFromPlaylist?: () => void;
}) {
  const {
    session,
    gateway,
    taste,
    token,
    artBaseFor,
    lastfm,
    getLastfmConfig,
    startRadio,
    downloadTracks,
    removeDownload,
    downloadsList,
    connectivity,
  } = useStore();
  const router = useRouter();
  const [addOpen, setAddOpen] = useState(false);
  const [rating, setRating] = useState<number | null>(track?.userRating ?? null);

  useEffect(() => {
    setRating(track?.userRating ?? null);
  }, [track]);

  if (!track) return null;
  const base = artBaseFor(track.serverId);
  const art = base && token ? artUrl(base, track.thumb, token) : null;
  const downloadedRecord = downloadRecordFor(buildDownloadLookup(downloadsList()), track);
  const isDownloaded = !!downloadedRecord;
  const offline = connectivity === "offline";

  async function rate(r: number | null) {
    setRating(r); // optimistic
    try {
      await gateway.rateItem(track!.serverId, track!.id, r, token ?? "");
      taste.recordTrackRating({ title: track!.title, artistName: track!.artistName }, r);
      if (getLastfmConfig().loveOnRating) {
        const t = { artistName: track!.artistName, title: track!.title };
        if (r !== null && r >= 8) {
          void lastfm.love(t);
        } else {
          void lastfm.unlove(t);
        }
      }
    } catch {
      setRating(track!.userRating ?? null); // revert on failure
    }
  }

  const go = (pathname: string, params: Record<string, string>) => {
    onClose();
    router.push({ pathname, params } as never);
  };

  const Row = ({
    icon,
    label,
    onPress,
    danger,
    disabled,
  }: {
    icon: React.ReactNode;
    label: string;
    onPress: () => void;
    danger?: boolean;
    disabled?: boolean;
  }) => (
    <Pressable
      onPress={disabled ? undefined : onPress}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingHorizontal: 16,
        paddingVertical: 12,
        opacity: disabled ? 0.4 : 1,
      }}
    >
      {icon}
      <Text style={{ color: danger ? "#e5534b" : theme.text, fontSize: 15 }}>{label}</Text>
    </Pressable>
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: "#0008" }} onPress={onClose} />
      <View
        style={{
          backgroundColor: theme.surface,
          borderTopLeftRadius: 16,
          borderTopRightRadius: 16,
          paddingBottom: 28,
        }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            padding: 16,
            borderBottomWidth: 1,
            borderBottomColor: theme.border,
          }}
        >
          <AlbumArt url={art} size={44} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: theme.text, fontWeight: "600" }} numberOfLines={1}>
              {track.title}
            </Text>
            <Text style={{ color: theme.textDim, fontSize: 12, marginBottom: 6 }} numberOfLines={1}>
              {[track.albumTitle, track.artistName].filter(Boolean).join(" · ")}
            </Text>
            <StarRating rating10={rating} onRate={(r) => void rate(r)} />
          </View>
        </View>

        <Row
          icon={<ListStart color={theme.accent} size={20} />}
          label="Play next"
          onPress={() => {
            void session.playTrackNext(track);
            onClose();
          }}
        />
        <Row
          icon={<ListEnd color={theme.accent} size={20} />}
          label="Add to queue"
          onPress={() => {
            void session.enqueueEnd([track]);
            onClose();
          }}
        />
        <Row
          icon={<ListPlus color={theme.accent} size={20} />}
          label="Add to playlist…"
          onPress={() => setAddOpen(true)}
        />
        {playlistContext ? (
          <Row
            icon={<Trash2 color="#e5534b" size={20} />}
            label="Remove from this playlist"
            danger
            onPress={async () => {
              await gateway.removeFromPlaylist(
                playlistContext.playlistId,
                track.serverId,
                [playlistContext.playlistItemId],
                token ?? "",
              );
              onClose();
              onRemovedFromPlaylist?.();
            }}
          />
        ) : null}
        {isDownloaded ? (
          <Row
            icon={<CircleCheck color={theme.accent} size={20} />}
            label="Remove download"
            onPress={() => {
              void removeDownload(downloadKey(track.serverId, track.media.partKey));
              onClose();
            }}
          />
        ) : (
          <Row
            icon={<Download color={theme.accent} size={20} />}
            label="Download"
            disabled={offline}
            onPress={() => {
              void downloadTracks([track]);
              onClose();
            }}
          />
        )}
        <Row
          icon={<Mic color={theme.text} size={20} />}
          label="Go to artist"
          onPress={() => go("/(tabs)/library/albums", { artistId: track.artistId })}
        />
        <Row
          icon={<Disc3 color={theme.text} size={20} />}
          label="Go to album"
          onPress={() => go("/(tabs)/library/tracks", { albumId: track.albumId })}
        />
        <Row
          icon={<Radio color={theme.accent} size={20} />}
          label="Start radio"
          disabled={offline}
          onPress={() => {
            startRadio({ artist: track.artistName, title: track.title, label: track.title });
            onClose();
          }}
        />
      </View>
      <AddToPlaylistSheet
        track={track}
        visible={addOpen}
        onClose={() => {
          setAddOpen(false);
          onClose();
        }}
      />
    </Modal>
  );
}
