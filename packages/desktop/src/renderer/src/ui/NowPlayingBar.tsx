import {
  ListMusic,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from "lucide-react";
import type { KeyboardEvent, MouseEvent } from "react";
import { useApp } from "../state/app";
import { usePlayer } from "../state/player";
import { useRatings } from "../state/ratings";
import { formatDuration } from "../util/format";
import { AlbumArt } from "./AlbumArt";
import { StarRating } from "./StarRating";
import { TrackSubLinks } from "./TrackSubLinks";

interface NowPlayingBarProps {
  onToggleQueue?: () => void;
}

export function NowPlayingBar({ onToggleQueue }: NowPlayingBarProps) {
  const { state, togglePlay, next, previous, seek, setVolume, toggleShuffle, cycleRepeat } =
    usePlayer();
  const { ratingFor, rate } = useRatings();
  const { library } = useApp();

  const track = state.queue ? state.queue.tracks[state.queue.index] : undefined;
  const hasTrack = track !== undefined;

  const positionMs = state.positionSec * 1000;
  const durationMs = state.durationSec * 1000;
  const progress = state.durationSec > 0 ? state.positionSec / state.durationSec : 0;
  const clampedProgress = Math.min(1, Math.max(0, progress));

  function handleSeekClick(e: MouseEvent<HTMLDivElement>) {
    if (state.durationSec <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const fraction = (e.clientX - rect.left) / rect.width;
    seek(Math.max(0, Math.min(1, fraction)) * state.durationSec);
  }

  function handleSeekKey(e: KeyboardEvent<HTMLDivElement>) {
    if (state.durationSec <= 0) return;
    const step = 5; // seconds
    if (e.key === "ArrowRight") seek(Math.min(state.durationSec, state.positionSec + step));
    if (e.key === "ArrowLeft") seek(Math.max(0, state.positionSec - step));
  }

  function handleVolumeChange(e: React.ChangeEvent<HTMLInputElement>) {
    setVolume(Number(e.target.value));
  }

  const isPlaying = state.status === "playing";
  const shuffle = state.queue?.shuffle ?? false;
  const repeat = state.queue?.repeat ?? "none";
  const repeatActive = repeat === "all" || repeat === "one";

  return (
    <div className="now-playing-bar">
      {/* Left: art + track meta */}
      <div className="np-left">
        <AlbumArt thumb={track?.thumb} className="np-art" />
        <div className="np-meta">
          <div className="np-title">{track?.title ?? ""}</div>
          <div className="np-sub">{track && <TrackSubLinks track={track} />}</div>
          {track && (
            <StarRating
              value10={ratingFor(track.id, track.userRating)}
              onRate={(stars) =>
                rate({
                  serverId: track.serverId,
                  itemId: track.id,
                  stars,
                  albumId: track.albumId || undefined,
                  libraryId: library?.id,
                })
              }
              size={13}
              className="np-stars"
            />
          )}
        </div>
      </div>

      {/* Centre: transport + seek */}
      <div className="np-centre">
        <div className="np-transport">
          <button
            type="button"
            className={`np-btn${shuffle ? " active" : ""}`}
            title="Shuffle"
            onClick={toggleShuffle}
            disabled={!hasTrack}
          >
            <Shuffle size={16} />
          </button>
          <button
            type="button"
            className="np-btn"
            title="Previous"
            onClick={previous}
            disabled={!hasTrack}
          >
            <SkipBack size={16} />
          </button>
          <button
            type="button"
            className="np-playpause"
            title={isPlaying ? "Pause" : "Play"}
            onClick={togglePlay}
            disabled={!hasTrack}
          >
            {isPlaying ? <Pause size={16} /> : <Play size={16} />}
          </button>
          <button type="button" className="np-btn" title="Next" onClick={next} disabled={!hasTrack}>
            <SkipForward size={16} />
          </button>
          <button
            type="button"
            className={`np-btn${repeatActive ? " active" : ""}`}
            title={
              repeat === "none" ? "Repeat: off" : repeat === "all" ? "Repeat: all" : "Repeat: one"
            }
            onClick={cycleRepeat}
            disabled={!hasTrack}
          >
            {repeat === "one" ? <Repeat1 size={16} /> : <Repeat size={16} />}
          </button>
        </div>

        <div className="np-seek">
          <span className="np-time">{formatDuration(positionMs)}</span>
          <div
            className="np-seek-bar"
            role="slider"
            aria-label="Seek"
            aria-valuenow={Math.round(state.positionSec)}
            aria-valuemin={0}
            aria-valuemax={Math.round(state.durationSec)}
            aria-disabled={!hasTrack || undefined}
            tabIndex={hasTrack ? 0 : -1}
            onClick={handleSeekClick}
            onKeyDown={handleSeekKey}
          >
            <div className="np-seek-fill" style={{ width: `${clampedProgress * 100}%` }} />
          </div>
          <span className="np-time">{formatDuration(durationMs)}</span>
        </div>
      </div>

      {/* Right: queue + volume */}
      <div className="np-right">
        <button
          type="button"
          className="np-btn"
          title="Queue"
          onClick={onToggleQueue ?? (() => undefined)}
          disabled={!hasTrack}
        >
          <ListMusic size={16} />
        </button>
        <button type="button" className="np-btn np-vol-btn" title="Volume">
          {state.volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
        </button>
        <input
          type="range"
          className="np-volume"
          min={0}
          max={1}
          step={0.01}
          value={state.volume}
          onChange={handleVolumeChange}
          aria-label="Volume"
        />
      </div>
    </div>
  );
}
