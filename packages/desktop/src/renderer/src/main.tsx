import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { installLogForwarding } from "./util/log-forward";

// Before anything renders (or logs): forward renderer console output into
// main's unified log buffer (Help → Show Logs).
installLogForwarding();

// Stamp the platform on the root element so CSS can branch on darwin vs
// non-darwin (e.g. drop the traffic-light left inset off macOS).
document.documentElement.dataset.platform = window.musex.platform;

// biome-ignore lint/style/noNonNullAssertion: root element is guaranteed by index.html
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
