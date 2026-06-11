import { useApp } from "../state/app";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";

/** Renders nothing — mounts the app-wide keyboard shortcut listener. Lives as
 *  a component (inside the provider tree) because the hook needs the player,
 *  app, selection, and ratings contexts. */
export function KeyboardShortcuts({
  toggleQueue,
  toggleShortcutsHelp,
  openSettings,
}: {
  toggleQueue: () => void;
  toggleShortcutsHelp: () => void;
  openSettings: () => void;
}) {
  const { dispatch } = useApp();
  useKeyboardShortcuts(
    toggleQueue,
    toggleShortcutsHelp,
    openSettings,
    () => dispatch({ type: "nav-back" }),
    () => dispatch({ type: "nav-forward" }),
  );
  return null;
}
