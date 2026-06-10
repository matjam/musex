import type { Track } from "@musex/core";
import { GripVertical, X } from "lucide-react";
import type { DragEvent, KeyboardEvent } from "react";
import { useRef, useState } from "react";
import { usePlayer } from "../state/player";
import { AlbumArt } from "./AlbumArt";
import { TrackSubLinks } from "./TrackSubLinks";

const MAX_UPCOMING_ROWS = 100;

interface QueueDrawerProps {
  open: boolean;
  onClose: () => void;
}

interface UpcomingRowProps {
  track: Track;
  realIndex: number;
  isDragOver: boolean;
  onJump: () => void;
  onRemove: () => void;
  onDragStart: (e: DragEvent<HTMLDivElement>) => void;
  onDragOver: (e: DragEvent<HTMLDivElement>) => void;
  onDragLeave: () => void;
  onDrop: (e: DragEvent<HTMLDivElement>) => void;
}

function UpcomingRow({
  track,
  realIndex,
  isDragOver,
  onJump,
  onRemove,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
}: UpcomingRowProps) {
  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onJump();
    }
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: listitem container carries draggable; interactive child (.queue-row-body) has role="button"
    <div
      className={`queue-row${isDragOver ? " drag-over" : ""}`}
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      data-index={realIndex}
    >
      <span className="queue-row-handle" aria-hidden>
        <GripVertical size={14} />
      </span>
      {/* biome-ignore lint/a11y/useSemanticElements: div needed here because it contains a <button> (remove); button-in-button is invalid HTML */}
      <div
        className="queue-row-body"
        role="button"
        tabIndex={0}
        onClick={onJump}
        onKeyDown={handleKeyDown}
        aria-label={`Play ${track.title} by ${track.artistName}`}
      >
        <AlbumArt thumb={track.thumb} className="queue-row-art" />
        <div className="queue-row-meta">
          <div className="queue-row-title">{track.title}</div>
          <div className="queue-row-sub">
            <TrackSubLinks track={track} />
          </div>
        </div>
      </div>
      <button
        type="button"
        className="queue-row-remove"
        title={`Remove ${track.title}`}
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        aria-label={`Remove ${track.title} from queue`}
      >
        <X size={13} />
      </button>
    </div>
  );
}

export function QueueDrawer({ open, onClose }: QueueDrawerProps) {
  const { state, clearQueue, removeFromQueue, moveInQueue, jumpTo } = usePlayer();
  const dragFromRef = useRef<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const queue = state.queue;

  const nowPlaying = queue !== null ? queue.tracks[queue.index] : undefined;
  const upcoming = queue !== null ? queue.tracks.slice(queue.index + 1) : [];
  const sliced = upcoming.slice(0, MAX_UPCOMING_ROWS);
  const overflow = upcoming.length - sliced.length;

  function handleDragStart(realIndex: number) {
    return (e: DragEvent<HTMLDivElement>) => {
      dragFromRef.current = realIndex;
      e.dataTransfer.effectAllowed = "move";
    };
  }

  function handleDragOver(realIndex: number) {
    return (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setDragOverIndex(realIndex);
    };
  }

  function handleDragLeave() {
    setDragOverIndex(null);
  }

  function handleDrop(targetRealIndex: number) {
    return (_e: DragEvent<HTMLDivElement>) => {
      setDragOverIndex(null);
      const from = dragFromRef.current;
      dragFromRef.current = null;
      if (from === null || from === targetRealIndex) return;
      moveInQueue(from, targetRealIndex);
    };
  }

  return (
    <aside className={`queue-drawer${open ? " queue-drawer--open" : ""}`} aria-label="Queue">
      <div className="queue-drawer-header">
        <span className="queue-drawer-title">Queue</span>
        <div className="queue-drawer-header-actions">
          {queue !== null && upcoming.length > 0 && (
            <button
              type="button"
              className="queue-clear-btn"
              onClick={clearQueue}
              title="Clear upcoming"
            >
              Clear
            </button>
          )}
          <button
            type="button"
            className="queue-close-btn"
            onClick={onClose}
            title="Close queue"
            aria-label="Close queue"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="queue-drawer-content">
        {queue === null ? (
          <div className="queue-empty">Queue is empty</div>
        ) : (
          <>
            {/* Now playing */}
            {nowPlaying !== undefined && (
              <div className="queue-section">
                <div className="queue-section-label">Now playing</div>
                <div className="queue-now-playing">
                  <AlbumArt thumb={nowPlaying.thumb} className="queue-row-art" />
                  <div className="queue-row-meta">
                    <div className="queue-row-title queue-row-title--playing">
                      {nowPlaying.title}
                    </div>
                    <div className="queue-row-sub">
                      <TrackSubLinks track={nowPlaying} />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Next up */}
            {sliced.length > 0 ? (
              <div className="queue-section">
                <div className="queue-section-label">Next up</div>
                {sliced.map((track, i) => {
                  const realIndex = queue.index + 1 + i;
                  return (
                    <UpcomingRow
                      key={`${track.id}-${realIndex}`}
                      track={track}
                      realIndex={realIndex}
                      isDragOver={dragOverIndex === realIndex}
                      onJump={() => jumpTo(realIndex)}
                      onRemove={() => removeFromQueue(realIndex)}
                      onDragStart={handleDragStart(realIndex)}
                      onDragOver={handleDragOver(realIndex)}
                      onDragLeave={handleDragLeave}
                      onDrop={handleDrop(realIndex)}
                    />
                  );
                })}
                {overflow > 0 && <div className="queue-overflow">+{overflow} more</div>}
              </div>
            ) : (
              upcoming.length === 0 && (
                <div className="queue-empty queue-empty--sub">No upcoming tracks</div>
              )
            )}
          </>
        )}
      </div>
    </aside>
  );
}
