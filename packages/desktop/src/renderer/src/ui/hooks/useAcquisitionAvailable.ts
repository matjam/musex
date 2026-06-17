import { useEffect, useState } from "react";

// Module-level cache: acquisitionAvailable() is asked once per renderer
// lifetime (providers register at plugin load, before the window exists).
let promise: Promise<boolean> | null = null;
let resolved = false;

function fetchAvailable(): Promise<boolean> {
  if (!promise) {
    promise = window.musex
      .acquisitionAvailable()
      .then((v) => {
        resolved = v;
        return v;
      })
      .catch((err: unknown) => {
        console.error("[acquisition] acquisitionAvailable failed:", err);
        return false;
      });
  }
  return promise;
}

/** Whether any acquisition provider is registered. Defaults to false until
 *  the one-shot IPC fetch resolves. */
export function useAcquisitionAvailable(): boolean {
  const [available, setAvailable] = useState(resolved);

  useEffect(() => {
    let cancelled = false;
    void fetchAvailable().then((v) => {
      if (!cancelled) setAvailable(v);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return available;
}
