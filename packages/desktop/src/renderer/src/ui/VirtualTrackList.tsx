import { useVirtualizer } from "@tanstack/react-virtual";
import { useRef } from "react";

interface Props {
  /** Total number of rows. */
  count: number;
  /** Estimated row height in px (used for initial layout; rows are measured for real). */
  estimateRowHeight?: number;
  /** Render-prop: caller supplies the full <TrackRow .../> for a given index. */
  renderRow: (index: number) => React.ReactNode;
}

/**
 * VirtualTrackList — renders only the visible track rows via @tanstack/react-virtual.
 *
 * The component owns the scroll container (the outer div). All three call sites
 * (PlaylistView, AlbumView, SearchView) replace their `.track-list`
 * div + inner `.map()` with this component. They pass a render-prop so each
 * view keeps full control of TrackRow props (onPlay, onMenu, isPlaying, leading,
 * showSubtitle, playlistContext, etc.).
 *
 * The scroll container must have a definite height for the virtualizer to work.
 * PlaylistView and AlbumView gain that from the `.album-detail` flex
 * layout (`.track-list { flex:1; overflow:auto }`). SearchView gives the
 * VirtualTrackList a max-height so it scrolls independently within the page.
 */
export function VirtualTrackList({ count, estimateRowHeight = 44, renderRow }: Props) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimateRowHeight,
    overscan: 5,
  });

  const totalSize = virtualizer.getTotalSize();

  return (
    <div ref={parentRef} className="track-list">
      {/* Spacer div that gives the scroll container its full virtual height. */}
      <div className="vtl-inner" style={{ height: totalSize }}>
        {virtualizer.getVirtualItems().map((virtualRow) => (
          <div
            key={virtualRow.key}
            ref={virtualizer.measureElement}
            data-index={virtualRow.index}
            className="vtl-row"
            style={{ transform: `translateY(${virtualRow.start}px)` }}
          >
            {renderRow(virtualRow.index)}
          </div>
        ))}
      </div>
    </div>
  );
}
