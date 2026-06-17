import type { Album, Track } from "@musex/core";
import { formatDuration, listValidator, relativeTime, smartTrackKey } from "@musex/core";
import { AudioLines, ExternalLink, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { ArtistInfoDto, TrackDetailDto, TrackStatDto } from "../../../../shared/ipc-contract";
import { useApp } from "../../state/app";
import { type EntityPanelPayload, usePanel } from "../../state/panel";
import { toTrackInfo, usePlayer } from "../../state/player";
import { useRatings } from "../../state/ratings";
import { OFFLINE_ACTION_TOOLTIP } from "../../util/offline";
import { AlbumArt } from "../AlbumArt";
import { StarRating } from "../StarRating";
import { ActionBar } from "./ActionBar";
import { EntityLink } from "./EntityLink";
import { useMonitorAction } from "./MonitorButton";

/** Unified right-hand panel for an artist / album / song. Replaces the separate
 *  TrackDetailPanel + ArtistInfoPanel — switches on payload.kind, preserving each
 *  one's behavior: hero artwork, clickable breadcrumb, Play/Similar/Monitor
 *  actions, metadata + listening stats, and the About section (artist bio /
 *  plugin-contributed track-detail sections). */
export function EntityPanel({ payload }: { payload: EntityPanelPayload }) {
  switch (payload.kind) {
    case "song":
      return <SongPanel track={payload.track} />;
    case "album":
      return <AlbumPanel album={payload.album} />;
    case "artist":
      return (
        <ArtistPanel
          artistName={payload.artistName}
          artistId={payload.artistId}
          serverId={payload.serverId}
          thumb={payload.thumb}
        />
      );
  }
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
          entity={{
            kind: "artist",
            name: track.artistName,
            artistId: track.artistId || undefined,
            serverId: track.serverId,
          }}
        >
          {track.artistName}
        </EntityLink>
        {track.albumTitle && (
          <>
            {" › "}
            <EntityLink
              entity={{
                kind: "album",
                albumId: track.albumId || undefined,
                serverId: track.serverId,
                artistId: track.artistId || undefined,
                title: track.albumTitle,
                thumb: track.thumb,
              }}
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

// ---- Album ---------------------------------------------------------------

function AlbumPanel({ album }: { album: Album }) {
  const { library, dispatch } = useApp();
  const { state, playTracks, playTracksShuffled } = usePlayer();
  const [tracks, setTracks] = useState<Track[] | null>(null);

  useEffect(() => {
    if (!library) return;
    let cancelled = false;
    setTracks(null);
    window.musex
      .listTracks(library.id, album.id, listValidator(album.updatedAt))
      .then((t) => {
        if (!cancelled) setTracks(t);
      })
      .catch((err) => console.error("[album] listTracks failed:", err));
    return () => {
      cancelled = true;
    };
  }, [library, album.id, album.updatedAt]);

  // Artist NAME comes from the first loaded track (Album carries only artistId).
  const artistName = tracks?.[0]?.artistName ?? "";
  const playingTrackId =
    state.queue != null ? (state.queue.tracks[state.queue.index]?.id ?? null) : null;
  const totalMs = (tracks ?? []).reduce((sum, t) => sum + t.durationMs, 0);

  return (
    <PanelShell label="Album">
      <AlbumArt thumb={album.thumb} className="detail-art" label={album.title} kind="album" />

      <div className="breadcrumb detail-crumb">
        {artistName && (
          <EntityLink
            entity={{
              kind: "artist",
              name: artistName,
              artistId: album.artistId || undefined,
              serverId: album.serverId,
            }}
          >
            {artistName}
          </EntityLink>
        )}
        {artistName && " › "}
        <span className="breadcrumb-current">{album.title}</span>
      </div>

      <div className="detail-title">{album.title}</div>

      <ActionBar
        onPlay={tracks && tracks.length > 0 ? () => playTracks(tracks, 0) : undefined}
        onShuffle={tracks && tracks.length > 0 ? () => playTracksShuffled(tracks) : undefined}
        onSimilar={
          artistName
            ? () =>
                dispatch({
                  type: "navigate",
                  view: { name: "similar", target: { kind: "artist", name: artistName } },
                })
            : undefined
        }
      />

      <div className="detail-meta">
        {album.year != null && (
          <div className="detail-meta-row">
            <span>Year</span>
            <span>{album.year}</span>
          </div>
        )}
        {tracks != null && (
          <div className="detail-meta-row">
            <span>Tracks</span>
            <span>{tracks.length}</span>
          </div>
        )}
        {totalMs > 0 && (
          <div className="detail-meta-row">
            <span>Duration</span>
            <span>{formatDuration(totalMs)}</span>
          </div>
        )}
      </div>

      {tracks != null && (
        <div className="detail-meta detail-plugin">
          <div className="detail-plugin-title">Tracks</div>
          {tracks.map((t) => (
            <div
              key={t.id}
              className={`detail-meta-row${t.id === playingTrackId ? " playing" : ""}`}
            >
              <span>
                {t.trackNumber != null ? `${t.trackNumber}. ` : ""}
                {t.title}
              </span>
              <span>{formatDuration(t.durationMs)}</span>
            </div>
          ))}
        </div>
      )}
    </PanelShell>
  );
}

// ---- Artist --------------------------------------------------------------

type ArtistFetch = { status: "loading" } | { status: "ok"; info: ArtistInfoDto | null };

function ArtistPanel({
  artistName,
  artistId,
  serverId,
  thumb,
}: {
  artistName: string;
  artistId?: string;
  serverId?: string;
  thumb?: string;
}) {
  const { dispatch, connectivity } = useApp();
  const offline = connectivity === "offline";
  const { closePanel } = usePanel();
  const monitor = useMonitorAction(artistName);
  const [fetch, setFetch] = useState<ArtistFetch>({ status: "loading" });

  useEffect(() => {
    setFetch({ status: "loading" });
    let cancelled = false;
    window.musex
      .artistInfoGet(artistName)
      .then((info) => {
        if (!cancelled) setFetch({ status: "ok", info });
      })
      .catch(() => {
        if (!cancelled) setFetch({ status: "ok", info: null });
      });
    return () => {
      cancelled = true;
    };
  }, [artistName]);

  const info = fetch.status === "ok" ? fetch.info : null;
  // Prefer the library thumb; fall back to the provider image.
  const heroThumb = thumb ?? info?.imageUrl;

  function browseAlbums() {
    closePanel();
    dispatch({ type: "navigate", view: { name: "external-artist", artistName } });
  }

  return (
    <PanelShell label="Artist">
      <AlbumArt
        thumb={heroThumb}
        className="detail-art artist-art"
        label={artistName}
        kind="artist"
      />

      <div className="detail-title">{artistName}</div>

      <ActionBar
        onSimilar={() =>
          dispatch({
            type: "navigate",
            view: { name: "similar", target: { kind: "artist", name: artistName } },
          })
        }
        monitor={
          monitor.supported
            ? {
                on: monitor.on,
                busy: monitor.busy,
                disabled: offline,
                title: offline ? OFFLINE_ACTION_TOOLTIP : undefined,
                onToggle: monitor.onToggle,
              }
            : undefined
        }
      />

      {fetch.status === "loading" && (
        <div className="detail-meta-row">
          <span>Looking up artist…</span>
        </div>
      )}

      {(info?.listeners != null || info?.playCount != null) && (
        <div className="detail-meta">
          {info?.listeners != null && (
            <div className="detail-meta-row">
              <span>Listeners</span>
              <span>{info.listeners.toLocaleString()}</span>
            </div>
          )}
          {info?.playCount != null && (
            <div className="detail-meta-row">
              <span>Plays</span>
              <span>{info.playCount.toLocaleString()}</span>
            </div>
          )}
        </div>
      )}

      {info?.bio && (
        <div className="detail-meta detail-plugin">
          <div className="detail-plugin-title">About</div>
          <p className="artist-info-bio">{info.bio}</p>
        </div>
      )}

      {fetch.status === "ok" && !info && (
        <div className="detail-meta-row">
          <span>No artist info available.</span>
        </div>
      )}

      <div className="artist-info-actions">
        {/* Owned artists navigate to their detail view; unowned browse the
            external discography. artistId+serverId present = owned. */}
        {artistId && serverId ? (
          <button
            type="button"
            className="settings-btn"
            onClick={() => {
              closePanel();
              dispatch({
                type: "navigate",
                view: { name: "artist", artist: { id: artistId, serverId, name: artistName } },
              });
            }}
          >
            Open artist
          </button>
        ) : (
          <button type="button" className="settings-btn" onClick={browseAlbums}>
            Browse albums
          </button>
        )}
        {info?.url && (
          <button
            type="button"
            className="settings-btn"
            onClick={() => void window.musex.openExternal(info.url as string)}
          >
            <ExternalLink size={14} /> View on last.fm
          </button>
        )}
      </div>
    </PanelShell>
  );
}
