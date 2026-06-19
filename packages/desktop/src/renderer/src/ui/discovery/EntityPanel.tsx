import type { Track } from "@musex/core";
import {
  entityRefForAlbum,
  entityRefForArtist,
  externalAlbumRef,
  externalArtistRef,
  formatDuration,
  relativeTime,
  smartTrackKey,
} from "@musex/core";
import { AudioLines, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { TrackDetailDto, TrackStatDto } from "../../../../shared/ipc-contract";
import { useApp } from "../../state/app";
import { type EntityPanelPayload, usePanel } from "../../state/panel";
import { toTrackInfo, usePlayer } from "../../state/player";
import { useRatings } from "../../state/ratings";
import { AlbumArt } from "../AlbumArt";
import { StarRating } from "../StarRating";
import { ActionBar } from "./ActionBar";
import { EntityLink } from "./EntityLink";

/** The right-hand context panel — now-playing / track-detail ONLY (entity
 *  navigation always goes to the unified pages, never the panel). Renders the
 *  selected/now-playing track: hero artwork, clickable breadcrumb (→ unified
 *  artist/album pages via EntityLink), Play/Similar, rating, metadata, listening
 *  stats, and plugin-contributed track-detail sections. */
export function EntityPanel({ payload }: { payload: EntityPanelPayload }) {
  return <SongPanel track={payload.track} />;
}

/** Shared panel chrome: header (kind label + close) wrapping the content. */
function PanelShell({ label, children }: { label: string; children: React.ReactNode }) {
  const { closePanel } = usePanel();
  return (
    <aside className="detail-panel">
      <div className="detail-head">
        <span className="detail-head-label">{label}</span>
        <button
          type="button"
          className="detail-close"
          title="Close"
          onClick={() => closePanel("entity")}
        >
          <X size={16} />
        </button>
      </div>
      {children}
    </aside>
  );
}

// ---- Song ----------------------------------------------------------------

function SongPanel({ track }: { track: Track }) {
  const { dispatch, library } = useApp();
  const { ratingFor, rate } = useRatings();
  const { state, playTrackNext } = usePlayer();
  const [pluginDetails, setPluginDetails] = useState<TrackDetailDto[]>([]);
  const [listenStat, setListenStat] = useState<TrackStatDto | null>(null);

  // Plugin-contributed detail sections; refetched per track. The cancelled flag
  // guards against a stale (slower) response landing after the panel changed.
  useEffect(() => {
    setPluginDetails([]);
    let cancelled = false;
    window.musex
      .trackDetailGet(toTrackInfo(track))
      .then((details) => {
        if (!cancelled) setPluginDetails(details);
      })
      .catch((err) => console.error("[plugins] trackDetailGet failed:", err));
    return () => {
      cancelled = true;
    };
  }, [track]);

  // Listening stats from the taste profile, joined by artist+title key.
  useEffect(() => {
    setListenStat(null);
    let cancelled = false;
    const key = smartTrackKey(track);
    window.musex
      .getTasteSnapshot()
      .then((snapshot) => {
        if (!cancelled) setListenStat(snapshot.stats.find((s) => s.key === key) ?? null);
      })
      .catch((err) => console.error("[taste] getTasteSnapshot failed:", err));
    return () => {
      cancelled = true;
    };
  }, [track]);

  // Now-playing detection mirrors the views' playingTrackId derivation.
  const playingTrackId =
    state.queue != null ? (state.queue.tracks[state.queue.index]?.id ?? null) : null;
  const isNowPlaying = playingTrackId === track.id;

  const codec = track.media.audioCodec ? track.media.audioCodec.toUpperCase() : null;
  const quality = [codec, track.media.bitrate ? `${Math.round(track.media.bitrate)} kbps` : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <PanelShell label="Song">
      <AlbumArt
        thumb={track.thumb}
        className="detail-art"
        label={track.albumTitle ?? track.title}
        kind="track"
      />

      {/* Hierarchy crumb: Artist › Album › Track (navigable via EntityLink). */}
      <div className="breadcrumb detail-crumb">
        <EntityLink
          entity={
            track.artistId
              ? entityRefForArtist({
                  id: track.artistId,
                  serverId: track.serverId,
                  name: track.artistName,
                })
              : externalArtistRef(track.artistName)
          }
        >
          {track.artistName}
        </EntityLink>
        {track.albumTitle && (
          <>
            {" › "}
            <EntityLink
              entity={
                track.albumId
                  ? entityRefForAlbum({
                      id: track.albumId,
                      serverId: track.serverId,
                      artistId: track.artistId,
                      title: track.albumTitle,
                      thumb: track.thumb,
                    })
                  : externalAlbumRef(track.albumTitle, track.artistName)
              }
            >
              {track.albumTitle}
            </EntityLink>
          </>
        )}
        {" › "}
        <span className="breadcrumb-current">{track.title}</span>
      </div>

      <div className="detail-title">{track.title}</div>

      {isNowPlaying && (
        <div className="monitor-status">
          <AudioLines size={13} /> Now playing
        </div>
      )}

      <StarRating
        value10={ratingFor(track.id, track.userRating)}
        onRate={(stars) =>
          rate({
            serverId: track.serverId,
            itemId: track.id,
            stars,
            albumId: track.albumId || undefined,
            libraryId: library?.id,
            trackInfo: toTrackInfo(track),
          })
        }
        size={15}
        className="detail-stars"
      />

      <ActionBar
        onPlay={() => playTrackNext(track)}
        onSimilar={() =>
          dispatch({
            type: "navigate",
            view: {
              name: "similar",
              target: { kind: "track", title: track.title, artist: track.artistName },
            },
          })
        }
      />

      <div className="detail-meta">
        {track.trackNumber != null && (
          <div className="detail-meta-row">
            <span>Track</span>
            <span>{track.trackNumber}</span>
          </div>
        )}
        <div className="detail-meta-row">
          <span>Duration</span>
          <span>{formatDuration(track.durationMs)}</span>
        </div>
        {quality && (
          <div className="detail-meta-row">
            <span>Quality</span>
            <span>{quality}</span>
          </div>
        )}
        {track.media.container && (
          <div className="detail-meta-row">
            <span>Container</span>
            <span>{track.media.container.toUpperCase()}</span>
          </div>
        )}
      </div>

      <div className="detail-meta detail-plugin">
        <div className="detail-plugin-title">Listening</div>
        {listenStat ? (
          <>
            <div className="detail-meta-row">
              <span>Plays</span>
              <span>{listenStat.plays}</span>
            </div>
            <div className="detail-meta-row">
              <span>Skips</span>
              <span>{listenStat.skips}</span>
            </div>
            <div className="detail-meta-row">
              <span>Last played</span>
              <span>{relativeTime(listenStat.lastPlayedMs, Date.now())}</span>
            </div>
          </>
        ) : (
          <div className="detail-meta-row">
            <span>Not played yet</span>
          </div>
        )}
      </div>

      {pluginDetails.map((d) => (
        <div key={`${d.pluginId}:${d.title}`} className="detail-meta detail-plugin">
          <div className="detail-plugin-title">{d.title}</div>
          {d.rows.map((r) => (
            <div key={r.label} className="detail-meta-row">
              <span>{r.label}</span>
              <span>{r.value}</span>
            </div>
          ))}
        </div>
      ))}
    </PanelShell>
  );
}
