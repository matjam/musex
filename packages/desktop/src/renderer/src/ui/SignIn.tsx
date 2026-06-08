import { useState } from "react";
import { useApp } from "../state/app";

export function SignIn() {
  const { auth, signInCode, dispatch } = useApp();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function start() {
    setError(null);
    setLoading(true);
    try {
      const { code } = await window.musex.signInStart();
      dispatch({ type: "signing-in", code });

      for (let i = 0; i < 150; i++) {
        await new Promise<void>((r) => setTimeout(r, 2000));
        const res = await window.musex.signInPoll();
        if (res.status === "ok") break;
        if (res.status === "error") {
          setError(res.message ?? "Sign-in failed. Please try again.");
          dispatch({ type: "signing-in", code: "" });
          setLoading(false);
          return;
        }
        if (i === 149) {
          setError("Timed out waiting for approval. Please try again.");
          dispatch({ type: "signing-in", code: "" });
          setLoading(false);
          return;
        }
      }

      const result = await window.musex.discoverLibraries();
      const lib = result.libraries[0];
      if (!lib) {
        setError("No music library found on your Plex server.");
        setLoading(false);
        return;
      }

      await window.musex.selectLibrary(lib.id);
      dispatch({ type: "signed-in", library: lib });
    } catch (e) {
      setError(e instanceof Error ? e.message : "An unexpected error occurred.");
      setLoading(false);
    }
  }

  function cancel() {
    setLoading(false);
    setError(null);
    // Reset to signed-out by dispatching a no-op that clears the signing-in state
    // We dispatch with an empty code — the reducer keeps auth: "signing-in" but the
    // polling loop above has already returned, so clicking Sign In again starts fresh.
    // To fully reset to signed-out we'd need a cancel action; for now simply reload.
    window.location.reload();
  }

  const isWaiting = auth === "signing-in" && signInCode;

  if (isWaiting) {
    return (
      <div className="signin-screen">
        <div className="signin-logo small brand">
          mus<span>ex</span>
        </div>
        <div className="signin-tagline compact">
          Approve this code in the browser tab we just opened.
        </div>
        <div className="signin-code">{signInCode}</div>
        <div className="signin-dots">
          <span />
          <span />
          <span />
        </div>
        <div className="signin-hint">
          {"Didn't open? Go to "}
          <a href="https://plex.tv/link" target="_blank" rel="noreferrer">
            plex.tv/link
          </a>
          {" and enter the code."}
        </div>
        {error ? <div className="signin-error">{error}</div> : null}
        <button type="button" className="signin-cancel" onClick={cancel}>
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="signin-screen">
      <div className="signin-logo brand">
        mus<span>ex</span>
      </div>
      <div className="signin-tagline">
        Your Plex library, with the feel of a modern streaming app.
      </div>
      <button type="button" className="signin-btn" onClick={() => void start()} disabled={loading}>
        <span className="plex-mark" />
        Sign in with Plex
      </button>
      {error ? <div className="signin-error">{error}</div> : null}
      <div className="signin-foot">
        Connects to your own Plex server · nothing leaves your machine
      </div>
    </div>
  );
}
