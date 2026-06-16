import type { PointerEvent as ReactPointerEvent } from "react";
import { useRef, useState } from "react";
import { useApp } from "../state/app";
import { usePanel } from "../state/panel";
import { usePlayer } from "../state/player";
import { useSelection } from "../state/selection";
import { EntityPanel } from "./discovery/EntityPanel";
import { derivePanelFocus } from "./discovery/panel-focus";
import { QueueDrawer } from "./QueueDrawer";

const MIN_WIDTH = 260;
const MAX_WIDTH = 520;
const DEFAULT_WIDTH = 320;
const WIDTH_KEY = "musex.panel.width";

function savedWidth(): number {
  const w = Number(localStorage.getItem(WIDTH_KEY));
  return Number.isFinite(w) && w >= MIN_WIDTH && w <= MAX_WIDTH ? w : DEFAULT_WIDTH;
}

/** Host for the right-hand side panels (entity context, queue). Open/close
 *  animates the host width while the content translates, so panels slide in
 *  and out; swapping panels keeps the host open and slides the new content in.
 *  The left edge is a drag handle — width is clamped and persisted. The last
 *  content stays mounted while closed so the exit animation has something to
 *  show (it's clipped to zero width, so it renders nothing visible).
 *
 *  The entity panel is a context surface: while open its content follows the
 *  user's focus via `derivePanelFocus` (override → selection → artist/album
 *  view → now-playing → nothing). It never opens itself. */
export function SidePanelHost() {
  const { panel, focusOverride } = usePanel();
  const { selectedTrack } = useSelection();
  const { view } = useApp();
  const { state } = usePlayer();
  const nowPlaying = state.queue ? (state.queue.tracks[state.queue.index] ?? null) : null;

  const [width, setWidth] = useState(savedWidth);
  const [resizing, setResizing] = useState(false);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  // Remembers what to render during the close animation.
  const lastPanelRef = useRef<typeof panel>(null);
  if (panel !== null) lastPanelRef.current = panel;
  const content = panel ?? lastPanelRef.current;

  // Derived context-panel content while the entity panel is open.
  const payload = derivePanelFocus({ override: focusOverride, selectedTrack, view, nowPlaying });
  // Mirror so the CLOSE animation still has content to show. While the panel is
  // open we show the live payload (or the placeholder when it's null); only
  // when closed do we fall back to the last shown entity for the exit slide.
  const lastPayloadRef = useRef<typeof payload>(null);
  if (payload !== null) lastPayloadRef.current = payload;
  const entity = panel === "entity" ? payload : (payload ?? lastPayloadRef.current);
  // Stable per-entity key so switching entities while open re-runs the slide-in.
  const entityKey = payload
    ? payload.kind === "song"
      ? `song:${payload.track.id}`
      : payload.kind === "album"
        ? `album:${payload.album.id}`
        : `artist:${payload.artistName}`
    : "empty";

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    dragRef.current = { startX: e.clientX, startWidth: width };
    setResizing(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    // Dragging left widens (the panel grows leftward from the window edge).
    const next = drag.startWidth + (drag.startX - e.clientX);
    setWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, next)));
  }

  function onPointerUp() {
    if (!dragRef.current) return;
    dragRef.current = null;
    setResizing(false);
    setWidth((w) => {
      localStorage.setItem(WIDTH_KEY, String(w));
      return w;
    });
  }

  return (
    <aside
      className={`side-panel${panel ? " side-panel--open" : ""}${resizing ? " side-panel--resizing" : ""}`}
      style={{ width: panel ? width : 0 }}
    >
      <div className="side-panel-inner" style={{ width }}>
        {/* biome-ignore lint/a11y/noStaticElementInteractions: pointer-only resize affordance; panel width is cosmetic */}
        <div
          className="side-panel-resize"
          aria-hidden="true"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        />
        {/* key swaps re-run the slide-in animation when one panel replaces another;
            for the entity panel the key also includes the entity identity so
            switching entities while open re-runs the slide-in animation. */}
        <div
          className="side-panel-content"
          key={`${content ?? "none"}:${content === "entity" ? entityKey : ""}`}
        >
          {content === "entity" &&
            (entity !== null ? (
              <EntityPanel payload={entity} />
            ) : (
              <div className="detail-panel">
                <div className="detail-empty">Nothing playing</div>
              </div>
            ))}
          {content === "queue" && <QueueDrawer />}
        </div>
      </div>
    </aside>
  );
}
