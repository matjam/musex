import { useEffect, useState } from "react";
import { AppProvider, useApp } from "./state/app";
import { PlayerProvider } from "./state/player";
import { PlaylistsProvider } from "./state/playlists";
import { RatingsProvider } from "./state/ratings";
import { SelectionProvider } from "./state/selection";
import { AboutModal } from "./ui/AboutModal";
import { KeyboardShortcuts } from "./ui/KeyboardShortcuts";
import { NowPlayingBar } from "./ui/NowPlayingBar";
import { QueueDrawer } from "./ui/QueueDrawer";
import { Shell } from "./ui/Shell";
import { ShortcutsModal } from "./ui/ShortcutsModal";
import { SignIn } from "./ui/SignIn";
import { Toasts } from "./ui/Toasts";
import { TopBar } from "./ui/TopBar";
import "./ui/theme.css";

function Inner() {
  const { auth, dispatch } = useApp();
  const [queueOpen, setQueueOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);

  // App-menu pushes (musex → About, Help → Keyboard Shortcuts like ⌘/).
  useEffect(() => {
    return window.musex.onNavigateTo((p) => {
      if (p.view === "about") setAboutOpen(true);
      else if (p.section === "shortcuts") setShortcutsOpen(true);
      else dispatch({ type: "navigate", view: { name: "settings" } });
    });
  }, [dispatch]);

  // Rendered in every auth state so the menu's About works pre-sign-in too.
  const about = aboutOpen && <AboutModal onClose={() => setAboutOpen(false)} />;

  if (auth === "restoring") {
    return (
      <div className="signin-screen">
        <div className="signin-logo brand">
          mus<span>ex</span>
        </div>
        <div className="signin-tagline">Restoring session…</div>
        {about}
      </div>
    );
  }
  if (auth === "signed-in") {
    return (
      <PlaylistsProvider>
        <SelectionProvider>
          <RatingsProvider>
            <KeyboardShortcuts
              toggleQueue={() => setQueueOpen((o) => !o)}
              toggleShortcutsHelp={() => setShortcutsOpen((o) => !o)}
            />
            <div className="app-root">
              <TopBar />
              <Shell />
              <NowPlayingBar onToggleQueue={() => setQueueOpen((o) => !o)} />
              <QueueDrawer open={queueOpen} onClose={() => setQueueOpen(false)} />
              <Toasts />
              {shortcutsOpen && <ShortcutsModal onClose={() => setShortcutsOpen(false)} />}
              {about}
            </div>
          </RatingsProvider>
        </SelectionProvider>
      </PlaylistsProvider>
    );
  }
  return (
    <>
      <SignIn />
      {about}
    </>
  );
}

export function App() {
  return (
    <AppProvider>
      <PlayerProvider>
        <Inner />
      </PlayerProvider>
    </AppProvider>
  );
}
