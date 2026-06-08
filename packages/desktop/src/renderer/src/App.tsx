import { AppProvider, useApp } from "./state/app";
import { PlayerProvider } from "./state/player";
import { NowPlayingBar } from "./ui/NowPlayingBar";
import { Shell } from "./ui/Shell";
import { SignIn } from "./ui/SignIn";
import "./ui/theme.css";

function Inner() {
  const { auth } = useApp();
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
      <div className="app-root">
        <Shell />
        <NowPlayingBar />
      </div>
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
