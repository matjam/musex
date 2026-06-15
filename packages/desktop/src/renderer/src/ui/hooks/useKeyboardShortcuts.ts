import { useEffect, useRef } from "react";
import { useApp } from "../../state/app";
import { toTrackInfo, usePlayer } from "../../state/player";
import { useRatings } from "../../state/ratings";
import { useSelection } from "../../state/selection";

/** Display table for the Settings "Keyboard Shortcuts" section. Kept in this
 *  file, next to the handler, so the documentation and the behavior can't
 *  drift apart. Pass `platform` to get the correct modifier glyphs:
 *  mac uses ⌘/⌥ symbols; other platforms use Ctrl/Alt text labels. */
export function getShortcutGroups(
  platform: string,
): { title: string; items: { combo: string; label: string }[] }[] {
  const isMac = platform === "darwin";
  // Display-only: behavior already uses ctrlKey|metaKey correctly.
  const mod = isMac ? "⌘" : "Ctrl";
  const alt = isMac ? "⌥" : "Alt";
  return [
    {
      title: "Playback",
      items: [
        { combo: "Space", label: "Play / Pause" },
        { combo: "M", label: "Mute / Unmute" },
        { combo: `${mod}→ / ${mod}←`, label: "Next / Previous track" },
        { combo: "⇧→ / ⇧←", label: "Seek forward / back 5 seconds" },
        { combo: `${mod}↑ / ${mod}↓`, label: "Volume up / down" },
        { combo: `${alt}S`, label: "Toggle shuffle" },
        { combo: `${alt}R`, label: "Cycle repeat" },
      ],
    },
    {
      title: "Navigation",
      items: [
        { combo: `${mod}K`, label: "Focus the search box" },
        { combo: `${mod},`, label: "Open Settings" },
        { combo: `${mod}/`, label: "Help / keyboard shortcuts" },
        { combo: `${mod}[`, label: "Back" },
        { combo: `${mod}]`, label: "Forward" },
        { combo: `${alt}⇧H`, label: "Go to Home" },
        { combo: `${alt}⇧0`, label: "Go to Tracks" },
        { combo: `${alt}⇧3`, label: "Go to Artists" },
        { combo: `${alt}⇧4`, label: "Go to Albums" },
        { combo: `${alt}⇧D`, label: "Go to Discover" },
        { combo: `${alt}⇧Q`, label: "Toggle the queue" },
        { combo: `${alt}⇧J`, label: "Go to Now Playing" },
      ],
    },
    {
      title: "Ratings",
      items: [
        { combo: "1–5", label: "Rate the current track" },
        { combo: "0", label: "Clear the current track's rating" },
      ],
    },
  ];
}

/** Convenience constant using the mac platform glyphs (default for any caller
 *  that doesn't pass a platform — ShortcutsModal passes it explicitly). */
export const SHORTCUT_GROUPS = getShortcutGroups("darwin");

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** App-wide keyboard shortcuts (Spotify mac bindings where they exist, musex
 *  ones for the rest — see SHORTCUT_GROUPS). Matching uses `e.code` whenever
 *  Alt is involved because macOS substitutes symbols for Alt+letter/digit
 *  (Alt+S → "ß", Alt+Shift+0 → "º"), which breaks `e.key` matching. */
export function useKeyboardShortcuts(
  toggleQueue: () => void,
  toggleShortcutsHelp: () => void,
  openSettings: () => void,
  navBack: () => void,
  navForward: () => void,
): void {
  const player = usePlayer();
  const { library, dispatch } = useApp();
  const { rate } = useRatings();
  const { select } = useSelection();

  /** Volume before the last mute, so M restores it. */
  const preMuteVolumeRef = useRef<number | null>(null);

  // Latest-ref pattern: the window listener is registered once and always
  // dispatches to the freshest closure (player state, library, etc.).
  const handlerRef = useRef<(e: KeyboardEvent) => void>(() => {});

  useEffect(() => {
    handlerRef.current = (e: KeyboardEvent) => {
      const meta = e.metaKey;
      const alt = e.altKey;
      const shift = e.shiftKey;
      const ctrl = e.ctrlKey;

      const target = e.target;
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable);

      const handled = () => {
        e.preventDefault();
        e.stopPropagation();
      };

      const st = player.state;
      const track = st.queue ? st.queue.tracks[st.queue.index] : undefined;

      // ── ⌘ combos ────────────────────────────────────────────────────────
      if (meta && !alt && !shift && !ctrl) {
        // ⌘K / ⌘, work even while typing in an input.
        if (e.code === "KeyK") {
          handled();
          document.getElementById("topbar-search-input")?.focus();
          return;
        }
        if (e.code === "Comma") {
          handled();
          openSettings();
          return;
        }
        if (e.code === "BracketLeft") {
          handled();
          navBack();
          return;
        }
        if (e.code === "BracketRight") {
          handled();
          navForward();
          return;
        }
        if (e.code === "Slash") {
          handled();
          toggleShortcutsHelp();
          return;
        }
        if (typing) return; // ⌘+arrows must keep their text-editing meaning
        if (e.code === "ArrowRight") {
          handled();
          player.next();
          return;
        }
        if (e.code === "ArrowLeft") {
          handled();
          player.previous();
          return;
        }
        if (e.code === "ArrowUp") {
          handled();
          player.setVolume(clamp(Math.round((st.volume + 0.1) * 10) / 10, 0, 1));
          return;
        }
        if (e.code === "ArrowDown") {
          handled();
          player.setVolume(clamp(Math.round((st.volume - 0.1) * 10) / 10, 0, 1));
          return;
        }
        return;
      }

      // Everything below is plain typing territory — never fire from inputs.
      if (typing) return;

      // ── ⌥⇧ combos (navigation) ──────────────────────────────────────────
      if (alt && shift && !meta && !ctrl) {
        if (e.code === "KeyH") {
          handled();
          dispatch({ type: "navigate", view: { name: "home" } });
          return;
        }
        if (e.code === "Digit0") {
          handled();
          dispatch({ type: "navigate", view: { name: "tracks" } });
          return;
        }
        if (e.code === "Digit3") {
          handled();
          dispatch({ type: "navigate", view: { name: "artists" } });
          return;
        }
        if (e.code === "Digit4") {
          handled();
          dispatch({ type: "navigate", view: { name: "albums" } });
          return;
        }
        if (e.code === "KeyD") {
          handled();
          dispatch({ type: "navigate", view: { name: "discover" } });
          return;
        }
        if (e.code === "KeyQ") {
          handled();
          toggleQueue();
          return;
        }
        if (e.code === "KeyJ") {
          handled();
          if (track) select(track); // opens the track detail panel
          return;
        }
        return;
      }

      // ── ⌥ combos ────────────────────────────────────────────────────────
      if (alt && !shift && !meta && !ctrl) {
        if (e.code === "KeyS") {
          handled();
          player.toggleShuffle();
          return;
        }
        if (e.code === "KeyR") {
          handled();
          player.cycleRepeat();
          return;
        }
        return;
      }

      // ── ⇧ combos (seek) ─────────────────────────────────────────────────
      if (shift && !alt && !meta && !ctrl) {
        if (e.code === "ArrowRight") {
          handled();
          if (track) player.seek(clamp(st.positionSec + 5, 0, st.durationSec));
          return;
        }
        if (e.code === "ArrowLeft") {
          handled();
          if (track) player.seek(clamp(st.positionSec - 5, 0, st.durationSec));
          return;
        }
        return;
      }

      // ── Unmodified keys ─────────────────────────────────────────────────
      if (!meta && !alt && !shift && !ctrl) {
        if (e.code === "Space") {
          handled(); // Space must never scroll the page
          if (st.queue) player.togglePlay();
          return;
        }
        if (e.code === "KeyM") {
          handled();
          if (st.volume > 0) {
            preMuteVolumeRef.current = st.volume;
            player.setVolume(0);
          } else {
            player.setVolume(preMuteVolumeRef.current ?? 0.5);
            preMuteVolumeRef.current = null;
          }
          return;
        }
        const digit = /^Digit([0-5])$/.exec(e.code)?.[1];
        if (digit !== undefined && track) {
          handled();
          const stars = Number(digit);
          rate({
            serverId: track.serverId,
            itemId: track.id,
            stars: stars === 0 ? null : stars,
            albumId: track.albumId || undefined,
            libraryId: library?.id,
            trackInfo: toTrackInfo(track),
          });
          return;
        }
      }
    };
  });

  useEffect(() => {
    const listener = (e: KeyboardEvent) => handlerRef.current(e);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);
}
