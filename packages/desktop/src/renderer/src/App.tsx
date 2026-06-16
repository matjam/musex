import { useEffect, useState } from "react";
import { AppProvider, useApp } from "./state/app";
import { MonitoringProvider } from "./state/monitoring";
import { PanelProvider, usePanel } from "./state/panel";
import { PlayerProvider } from "./state/player";
import { PlaylistsProvider } from "./state/playlists";
import { RatingsProvider } from "./state/ratings";
import { SelectionProvider } from "./state/selection";
import { AboutModal } from "./ui/AboutModal";
import { KeyboardShortcuts } from "./ui/KeyboardShortcuts";
import { LogsModal } from "./ui/LogsModal";
import { NowPlayingBar } from "./ui/NowPlayingBar";
import { SettingsModal } from "./ui/SettingsModal";
import { Shell } from "./ui/Shell";
import { ShortcutsModal } from "./ui/ShortcutsModal";
import { SignIn } from "./ui/SignIn";
import { SplashScreen } from "./ui/SplashScreen";
import { Toasts } from "./ui/Toasts";
import { TopBar } from "./ui/TopBar";
import "./ui/theme.css";

function Inner() {
  const { auth, dispatch } = useApp();
  const { togglePanel } = usePanel();
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<string | null>(null);

  // App-menu pushes (musex → About/Settings…, Help → Shortcuts/Show Logs).
  useEffect(() => {
    return window.musex.onNavigateTo((p) => {
      if (p.view === "about") setAboutOpen(true);
      else if (p.view === "logs") setLogsOpen(true);
      else if (p.section === "shortcuts") setShortcutsOpen(true);
      else {
        setSettingsSection(p.view === "settings" ? (p.section ?? null) : null);
        setSettingsOpen(true);
      }
    });
  }, []);

  // Rendered in every auth state so the menu items work pre-sign-in too.
  const about = (
    <>
      {aboutOpen && <AboutModal onClose={() => setAboutOpen(false)} />}
      {logsOpen && <LogsModal onClose={() => setLogsOpen(false)} />}
      {settingsOpen && (
        <SettingsModal
          initialCategory={settingsSection}
          onClose={() => {
            setSettingsOpen(false);
            // A deep-linked category must not leak into the next plain ⌘, open.
            setSettingsSection(null);
          }}
        />
      )}
    </>
  );

  if (auth === "restoring") {
    return (
      <>
        <SplashScreen />
        {about}
      </>
    );
  }
  if (auth === "signed-in") {
    return (
      <MonitoringProvider>
        <PlaylistsProvider>
          <SelectionProvider>
            <RatingsProvider>
              <KeyboardShortcuts
                toggleQueue={() => togglePanel("queue")}
                toggleShortcutsHelp={() => setShortcutsOpen((o) => !o)}
                openSettings={() => setSettingsOpen(true)}
              />
              <div className="app-root">
                <TopBar />
                <Shell />
                <NowPlayingBar onToggleQueue={() => togglePanel("queue")} />
                <Toasts />
                {shortcutsOpen && <ShortcutsModal onClose={() => setShortcutsOpen(false)} />}
                {about}
              </div>
            </RatingsProvider>
          </SelectionProvider>
        </PlaylistsProvider>
      </MonitoringProvider>
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
        <PanelProvider>
          <Inner />
        </PanelProvider>
      </PlayerProvider>
    </AppProvider>
  );
}
