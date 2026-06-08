import type { Library } from "@musex/core";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";

function App(): React.JSX.Element {
  const [status, setStatus] = useState("idle");
  const [code, setCode] = useState("");
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [error, setError] = useState("");

  async function signIn(): Promise<void> {
    setStatus("starting…");
    setError("");
    setLibraries([]);
    const started = await window.musex.signInStart();
    setCode(started.code);
    setStatus("waiting for approval in your browser…");
    for (let i = 0; i < 150; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const res = await window.musex.signInPoll();
      if (res.status === "ok") break;
      if (res.status === "error") {
        setError(res.message ?? "sign-in failed");
        setStatus("error");
        return;
      }
      if (i === 149) {
        setError("timed out waiting for approval");
        setStatus("error");
        return;
      }
    }
    setStatus("discovering libraries…");
    const result = await window.musex.discoverLibraries();
    setLibraries(result.libraries);
    const unreachable = result.unreachable.length
      ? `, ${result.unreachable.length} server(s) unreachable`
      : "";
    setStatus(`done — ${result.libraries.length} music library(ies)${unreachable}`);
  }

  return (
    <div style={{ padding: 24, fontFamily: "system-ui", color: "#e7e9ee" }}>
      <h1>musex — backend smoke</h1>
      <button type="button" onClick={() => void signIn()}>
        Sign in to Plex
      </button>
      {code ? (
        <p>
          Approve code <strong>{code}</strong> in the browser window that opened.
        </p>
      ) : null}
      <p>Status: {status}</p>
      {error ? <p style={{ color: "tomato" }}>Error: {error}</p> : null}
      <ul>
        {libraries.map((l) => (
          <li key={l.id}>
            {l.title} — {l.serverName}
          </li>
        ))}
      </ul>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
