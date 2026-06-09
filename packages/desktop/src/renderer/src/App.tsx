import { useState } from "react";
import { AppProvider, useApp } from "./state/app";
import { PlayerProvider } from "./state/player";
import { PlaylistsProvider } from "./state/playlists";
import { NowPlayingBar } from "./ui/NowPlayingBar";
import { QueueDrawer } from "./ui/QueueDrawer";
import { Shell } from "./ui/Shell";
import { SignIn } from "./ui/SignIn";
import { TopBar } from "./ui/TopBar";
import "./ui/theme.css";

function Inner() {
  const { auth } = useApp();
  const [queueOpen, setQueueOpen] = useState(false);

  if (auth === "restoring") {
    return (
      <div className="signin-screen">
        <div className="signin-logo brand">
          mus<span>ex</span>
        </div>
        <div className="signin-tagline">Restoring session…</div>
      </div>
    );
  }
  if (auth === "signed-in") {
    return (
      <PlaylistsProvider>
        <div className="app-root">
          <TopBar />
          <Shell />
          <NowPlayingBar onToggleQueue={() => setQueueOpen((o) => !o)} />
          <QueueDrawer open={queueOpen} onClose={() => setQueueOpen(false)} />
        </div>
      </PlaylistsProvider>
    );
  }
  return <SignIn />;
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
