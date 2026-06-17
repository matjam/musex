import lockScreenCommands from "../../modules/lock-screen-commands";

export interface RemoteCommandHandlers {
  onNext: () => void;
  onPrevious: () => void;
}

/** Subscribe to lock-screen / Control-Center next & previous track commands.
 *  Returns an unsubscribe function. A no-op (returning a no-op cleanup) when the
 *  native module isn't present — never throws. */
export function subscribeRemoteCommands(handlers: RemoteCommandHandlers): () => void {
  const mod = lockScreenCommands;
  if (!mod) return () => {};
  const next = mod.addListener("onNext", handlers.onNext);
  const prev = mod.addListener("onPrevious", handlers.onPrevious);
  return () => {
    next.remove();
    prev.remove();
  };
}
