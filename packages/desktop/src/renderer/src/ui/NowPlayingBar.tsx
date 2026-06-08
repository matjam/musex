import type { KeyboardEvent, MouseEvent } from "react";
import { usePlayer } from "../state/player";
import { formatDuration } from "../util/format";
import { AlbumArt } from "./AlbumArt";

export function NowPlayingBar() {
  const { state, togglePlay, next, previous, seek, setVolume } = usePlayer();

  // Nothing playing — render an empty placeholder bar to preserve layout
  if (state.queue === null) {
    return <div className="now-playing-bar now-playing-bar--empty" />;
  }

  const track = state.queue.tracks[state.queue.index];
  if (track === undefined) {
    return <div className="now-playing-bar now-playing-bar--empty" />;
  }

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
  const metaSub =
    track.albumTitle != null ? `${track.artistName} · ${track.albumTitle}` : track.artistName;

  return (
    <div className="now-playing-bar">
      {/* Left: art + track meta */}
      <div className="np-left">
        <AlbumArt thumb={track.thumb} className="np-art" />
        <div className="np-meta">
          <div className="np-title">{track.title}</div>
          <div className="np-sub">{metaSub}</div>
        </div>
      </div>

      {/* Centre: transport + seek */}
      <div className="np-centre">
        <div className="np-transport">
          <button type="button" className="np-btn" title="Previous" onClick={previous}>
            ⏮
          </button>
          <button
            type="button"
            className="np-playpause"
            title={isPlaying ? "Pause" : "Play"}
            onClick={togglePlay}
          >
            {isPlaying ? "⏸" : "▶"}
          </button>
          <button type="button" className="np-btn" title="Next" onClick={next}>
            ⏭
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
            tabIndex={0}
            onClick={handleSeekClick}
            onKeyDown={handleSeekKey}
          >
            <div className="np-seek-fill" style={{ width: `${clampedProgress * 100}%` }} />
          </div>
          <span className="np-time">{formatDuration(durationMs)}</span>
        </div>
      </div>

      {/* Right: volume */}
      <div className="np-right">
        <span className="np-vol-icon">🔊</span>
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
