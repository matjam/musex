import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";

/** Renders nothing — mounts the app-wide keyboard shortcut listener. Lives as
 *  a component (inside the provider tree) because the hook needs the player,
 *  app, selection, and ratings contexts. */
export function KeyboardShortcuts({ toggleQueue }: { toggleQueue: () => void }) {
  useKeyboardShortcuts(toggleQueue);
  return null;
}
