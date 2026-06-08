import { AppProvider, useApp } from "./state/app";
import { PlayerProvider } from "./state/player";
import { Shell } from "./ui/Shell";
import { SignIn } from "./ui/SignIn";
import "./ui/theme.css";

function Inner() {
  const { auth } = useApp();
  if (auth !== "signed-in") return <SignIn />;
  return <Shell />;
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
